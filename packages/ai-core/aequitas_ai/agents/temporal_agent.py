r"""
**Temporal (comparison) agent** (LangGraph): SQL split → delta math → **targeted** RAG.

For time-comparison questions, **Node 1** emits two **separate** read-only SQL
statements (one per period) to avoid fragile cross-period JOINs. **Node 2**
executes them and computes absolute and **percentage** change. **Node 3**
retrieves document chunks restricted to a **narrative time window** (metadata),
then an LLM writes the **contextual narrative**; the pipeline returns a single
**structured** JSON (baseline, new, :math:`\Delta\%`, narrative).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Awaitable, Callable, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State & structured output
# ---------------------------------------------------------------------------


class TemporalAgentState(TypedDict, total=False):
    user_query: str
    sql_baseline: str | None
    sql_new: str | None
    label_baseline: str
    label_new: str
    """Human-readable period labels (e.g. 'Q2 2026', 'Q3 2026')."""
    narrative_window_start: str
    narrative_window_end: str
    """ISO date strings (inclusive) for RAG metadata filtering."""
    sql_rows_baseline: list[dict[str, Any]]
    sql_rows_new: list[dict[str, Any]]
    baseline_value: float | None
    new_value: float | None
    delta_absolute: float | None
    delta_percent: float | None
    """Percentage change: (new - baseline) / |baseline| * 100, or null if not defined."""
    retrieved_chunks: list[dict[str, Any]]
    narrative: str
    result: dict[str, Any]
    """JSON-serializable :class:`TemporalAgentOutput` as dict."""
    rag_error: str | None
    error: str | None


class TemporalAgentOutput(BaseModel):
    """Structured result for APIs and dashboards."""

    baseline: float | None
    new: float | None
    delta_percent: float | None = Field(
        default=None,
        description=r"Percent change: $\frac{\text{new}-\text{baseline}}{|\text{baseline}|}\times 100$ when baseline ≠ 0.",
    )
    delta_absolute: float | None = None
    label_baseline: str = ""
    label_new: str = ""
    narrative: str
    """Contextual explanation grounded in SQL + RAG."""
    rag_error: str | None = None


# ---------------------------------------------------------------------------
# Config & prompts
# ---------------------------------------------------------------------------


@dataclass
class TemporalAgentConfig:
    """Inject LLM(s), SQL runner, RAG, and optional embedder for targeted retrieval."""

    split_llm: BaseChatModel
    narrative_llm: BaseChatModel
    # Async: run one read-only SQL; must return a dict with key "rows" (list[dict]).
    run_sql: Callable[[str], Awaitable[dict[str, Any]]]
    # Async: semantic query string → embedding vector for vector search.
    embed_query: Callable[[str], Awaitable[list[float]]]
    # Vector retrieval; use :meth:`SupabaseRagRetriever.retrieve` with time-window kwargs.
    retrieve: Callable[..., Awaitable[list[dict[str, Any]]]]
    # Schema excerpt for the splitter (table/column names, time columns).
    schema_context: str = ""


SPLITTER_SYSTEM = """You are a PostgreSQL query architect for **time-period comparisons**
(Aequitas FI).

**Goal:** The user wants to compare a metric between **two** time windows (e.g. Q2 vs Q3,
last month vs prior month, 2025 vs 2024). You must **not** produce one query that JOINs
or window-functions both periods together. Instead, output **two separate** read-only
queries:

1. **sql_baseline** — a single `SELECT` (or `WITH ... SELECT`) for the **earlier** or
   **reference** period only, with a **clear time filter** in the `WHERE` clause
   (e.g. on `ts_utc`, `as_of_utc`, `period_end`, or `filed_at_utc` as appropriate).
2. **sql_new** — the **same** metric and shape as baseline, for the **later** or
   **comparison** period only, with its own time filter.

Use only tables/columns that exist in the provided schema. Each statement must be
**read-only** (SELECT/CTE only). Avoid correlated subqueries across the two periods;
period separation is the point.

Also output:
- **label_baseline**, **label_new**: short labels (e.g. "Q2 2026", "Q3 2026").
- **narrative_window_start**, **narrative_window_end**: **inclusive** ISO `YYYY-MM-DD`
  dates spanning **both** periods (and any buffer you need for context), used to filter
  **document** metadata for the explanation step. This window must **cover** both periods.

**Output JSON only**, no markdown fences:
{
  "sql_baseline": "<sql>",
  "sql_new": "<sql>",
  "label_baseline": "<string>",
  "label_new": "<string>",
  "narrative_window_start": "YYYY-MM-DD",
  "narrative_window_end": "YYYY-MM-DD"
}"""


NARRATIVE_SYSTEM = """You are a financial research writer for Aequitas FI.
You are given: the user's question, two period labels, **numeric baseline and new
values**, absolute and **percent** change, a short description of the SQL result rows,
and **retrieved** document excerpts (earnings, filings) **restricted to a time window**.

Write a **concise** contextual **narrative** (2–4 sentences) that:
- Explains what the delta means in business terms.
- Ties the change to the **RAG** passages **when** they support a concrete point; if
  the passages are thin, say so briefly.

**Do not** invent numbers not in the provided metrics or rows. **Do not** output JSON.
Plain text only."""


# ---------------------------------------------------------------------------
# JSON / parsing
# ---------------------------------------------------------------------------


def _strip_json_fence(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```$", "", t)
    return t


async def _split_sql(
    llm: BaseChatModel,
    user_query: str,
    schema_context: str,
    prior_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    block = f"User question:\n{user_query}\n"
    if prior_result:
        pruned = {k: v for k, v in prior_result.items() if not str(k).startswith("_")}
        prev = json.dumps(pruned, default=str)
        if len(prev) > 8_000:
            prev = prev[:8_000] + "…"
        block += (
            "\nPrevious comparison result from this thread (user may be refining; "
            "keep continuity, or adjust periods/metrics as requested):\n"
            f"{prev}\n"
        )
    if schema_context.strip():
        block += f"\nSchema (reference only):\n{schema_context}\n"
    msg = [SystemMessage(content=SPLITTER_SYSTEM), HumanMessage(content=block)]
    try:
        res = await asyncio.wait_for(llm.ainvoke(msg), timeout=90.0)
    except asyncio.TimeoutError as e:
        raise RuntimeError("LLM call timed out after 90s") from e
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    data = json.loads(_strip_json_fence(str(raw)))
    for k in (
        "sql_baseline",
        "sql_new",
        "label_baseline",
        "label_new",
        "narrative_window_start",
        "narrative_window_end",
    ):
        if k not in data:
            raise KeyError(f"Splitter JSON missing key: {k}")
    return data


# ---------------------------------------------------------------------------
# Delta math (Node 2)
# ---------------------------------------------------------------------------

_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def _coerce_number(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and _NUM.match(v.strip()):
        return float(v.strip())
    return None


def _first_scalar_from_rows(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    row0 = rows[0]
    # Prefer common aggregate / metric names
    for key in (
        "value",
        "total",
        "sum",
        "amount",
        "metric",
        "result",
        "revenue",
        "notional",
        "pnl",
        "profit",
        "loss",
        "return",
        "price",
        "nav",
        "aum",
        "v",
    ):
        if key in row0:
            n = _coerce_number(row0.get(key))
            if n is not None:
                return n
    for k, v in row0.items():
        n = _coerce_number(v)
        if n is not None:
            log.warning(
                "_first_scalar_from_rows: no priority key found in row %s, using first numeric column '%s'",
                list(row0.keys()),
                k,
            )
            return n
    return None


def _compute_deltas(
    baseline: float | None, new: float | None
) -> tuple[float | None, float | None]:
    if baseline is None or new is None:
        return None, None
    d_abs = new - baseline
    if baseline == 0:
        return d_abs, None
    d_pct = (d_abs / abs(baseline)) * 100.0
    return d_abs, d_pct


# ---------------------------------------------------------------------------
# Narrative (Node 3)
# ---------------------------------------------------------------------------


async def _write_narrative(
    llm: BaseChatModel,
    user_query: str,
    state: dict[str, Any],
) -> str:
    rows_a = state.get("sql_rows_baseline") or []
    rows_b = state.get("sql_rows_new") or []
    ctx_rag = "\n\n---\n\n".join(
        f"SOURCE: {c.get('source', '')}\n"
        f"METADATA: {c.get('metadata') or c.get('chunk_metadata', {})}\n"
        f"TEXT:\n{c.get('content', '')[:2000]}"
        for c in (state.get("retrieved_chunks") or [])
    ) or "(no RAG context)"
    human = (
        f"User question:\n{user_query}\n\n"
        f"Labels: {state.get('label_baseline')} (baseline) vs {state.get('label_new')} (new).\n"
        f"Baseline value: {state.get('baseline_value')!s}\n"
        f"New value: {state.get('new_value')!s}\n"
        f"Absolute delta: {state.get('delta_absolute')!s}\n"
        f"Percent delta: {state.get('delta_percent')!s}\n\n"
        f"SQL rows (baseline period):\n{json.dumps(rows_a, default=str)[:4000]}\n\n"
        f"SQL rows (new period):\n{json.dumps(rows_b, default=str)[:4000]}\n\n"
        f"RAG excerpts (time-window–filtered):\n{ctx_rag}\n"
    )
    msg = [SystemMessage(content=NARRATIVE_SYSTEM), HumanMessage(content=human)]
    try:
        res = await asyncio.wait_for(llm.ainvoke(msg), timeout=90.0)
    except asyncio.TimeoutError as e:
        raise RuntimeError("LLM call timed out after 90s") from e
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    return str(raw).strip()


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_temporal_agent(
    config: TemporalAgentConfig,
    checkpointer: BaseCheckpointSaver | None = None,
):
    """
    Build a compiled graph: **sql_splitter** → **delta_calculator** → **targeted_rag** →
    assembles :class:`TemporalAgentOutput` in **result** and **narrative**.

    Invoke with e.g. ``{"user_query": "Compare Q2 vs Q3 revenue for ..."}``.

    When ``checkpointer`` is set and ``config`` includes a ``thread_id``, state is
    persisted for follow-up turns. Pass a prior **result** from the checkpoint into
    the splitter by keeping **result** in state (merged from the previous run).
    """

    async def sql_splitter(s: TemporalAgentState) -> dict[str, Any]:
        prior = s.get("result")
        prior_dict = prior if isinstance(prior, dict) and prior else None
        try:
            data = await _split_sql(
                config.split_llm,
                s.get("user_query", ""),
                config.schema_context,
                prior_result=prior_dict,
            )
        except Exception as e:  # noqa: BLE001
            return {
                "error": f"SQL split failed: {e}",
                "sql_baseline": None,
                "sql_new": None,
            }
        return {
            "sql_baseline": (data.get("sql_baseline") or "").strip() or None,
            "sql_new": (data.get("sql_new") or "").strip() or None,
            "label_baseline": str(data.get("label_baseline", "")).strip(),
            "label_new": str(data.get("label_new", "")).strip(),
            "narrative_window_start": str(data.get("narrative_window_start", "")).strip(),
            "narrative_window_end": str(data.get("narrative_window_end", "")).strip(),
            "error": None,
        }

    async def delta_calculator(s: TemporalAgentState) -> dict[str, Any]:
        if s.get("error"):
            return {}
        a = s.get("sql_baseline")
        b = s.get("sql_new")
        if not a or not b:
            return {
                "error": "Missing sql_baseline or sql_new from splitter.",
                "sql_rows_baseline": [],
                "sql_rows_new": [],
            }
        try:
            out_a, out_b = await asyncio.gather(
                config.run_sql(a), config.run_sql(b)
            )
        except Exception as e:  # noqa: BLE001
            return {
                "error": f"SQL execution failed: {e}",
                "sql_rows_baseline": [],
                "sql_rows_new": [],
            }
        if not isinstance(out_a, dict):
            out_a = {"rows": []}
        if not isinstance(out_b, dict):
            out_b = {"rows": []}
        ra = list(out_a.get("rows") or out_a.get("data") or [])
        rb = list(out_b.get("rows") or out_b.get("data") or [])
        if not ra and not rb:
            return {
                "error": "Both SQL result sets are empty; cannot compute delta.",
                "sql_rows_baseline": ra,
                "sql_rows_new": rb,
            }
        vb = _first_scalar_from_rows(ra)
        vn = _first_scalar_from_rows(rb)
        d_abs, d_pct = _compute_deltas(vb, vn)
        return {
            "sql_rows_baseline": ra,
            "sql_rows_new": rb,
            "baseline_value": vb,
            "new_value": vn,
            "delta_absolute": d_abs,
            "delta_percent": d_pct,
        }

    async def targeted_rag(s: TemporalAgentState) -> dict[str, Any]:
        if not s.get("sql_baseline") or not s.get("sql_new"):
            return {"retrieved_chunks": [], "rag_error": None}
        uq = s.get("user_query", "")
        q = (
            f"{uq}\n"
            f"Context: compare {s.get('label_baseline', '')} vs {s.get('label_new', '')}; "
            f"explain drivers of the change."
        )
        try:
            emb = await config.embed_query(q)
        except Exception as e:  # noqa: BLE001
            return {
                "retrieved_chunks": [],
                "rag_error": str(e),
            }
        t0 = s.get("narrative_window_start") or ""
        t1 = s.get("narrative_window_end") or ""
        # Pass through to retriever (SupabaseRagRetriever supports time-window kwargs).
        try:
            chunks = await config.retrieve(
                emb,
                metadata_time_start=t0 or None,
                metadata_time_end=t1 or None,
            )
        except TypeError:
            # Backward compatible: retriever may not accept keyword args
            try:
                chunks = await config.retrieve(emb)
            except Exception as e:  # noqa: BLE001
                return {
                    "retrieved_chunks": [],
                    "rag_error": str(e),
                }
        except Exception as e:  # noqa: BLE001
            return {
                "retrieved_chunks": [],
                "rag_error": str(e),
            }
        if (t0 or t1) and chunks:
            chunks = _filter_chunks_by_metadata_window(chunks, t0, t1)
        return {
            "query_embedding": emb,
            "retrieved_chunks": list(chunks or []),
            "rag_error": None,
        }

    async def assemble_node(s: TemporalAgentState) -> dict[str, Any]:
        err = s.get("error")
        split_broken = not s.get("sql_baseline") or not s.get("sql_new")
        if split_broken:
            msg = err or "Temporal comparison could not be completed (missing split SQL)."
            out = TemporalAgentOutput(
                baseline=None,
                new=None,
                delta_percent=None,
                delta_absolute=None,
                label_baseline=s.get("label_baseline", ""),
                label_new=s.get("label_new", ""),
                narrative=msg,
                rag_error=s.get("rag_error"),
            )
            d = out.model_dump()
            if err:
                d["_warning"] = err
            return {"narrative": out.narrative, "result": d}

        try:
            ntext = await _write_narrative(
                config.narrative_llm, s.get("user_query", ""), dict(s)
            )
        except Exception as e:  # noqa: BLE001
            ntext = f"Narrative generation failed: {e}"
        if err:
            ntext = f"{ntext}\n\nNote: {err}"
        rag_error = s.get("rag_error")
        if rag_error:
            ntext = f"{ntext}\n\n⚠ RAG context unavailable: {rag_error}"

        out = TemporalAgentOutput(
            baseline=s.get("baseline_value"),
            new=s.get("new_value"),
            delta_percent=s.get("delta_percent"),
            delta_absolute=s.get("delta_absolute"),
            label_baseline=s.get("label_baseline", ""),
            label_new=s.get("label_new", ""),
            narrative=ntext,
            rag_error=rag_error,
        )
        d = out.model_dump()
        if err:
            d["_warning"] = err
        return {"narrative": ntext, "result": d}

    g = StateGraph(TemporalAgentState)
    g.add_node("sql_splitter", sql_splitter)
    g.add_node("delta_calculator", delta_calculator)
    g.add_node("targeted_rag", targeted_rag)
    g.add_node("assemble", assemble_node)
    g.add_edge(START, "sql_splitter")
    g.add_edge("sql_splitter", "delta_calculator")
    g.add_edge("delta_calculator", "targeted_rag")
    g.add_edge("targeted_rag", "assemble")
    g.add_edge("assemble", END)
    if checkpointer is not None:
        return g.compile(checkpointer=checkpointer)
    return g.compile()


# ---------------------------------------------------------------------------
# RAG: metadata window filter (client-side)
# ---------------------------------------------------------------------------


def _parse_doc_date(val: Any) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    s = str(val).strip()
    if not s:
        return None
    s10 = s[:10]
    try:
        return date.fromisoformat(s10)
    except ValueError:
        return None


def _metadata_timestamp(row: dict[str, Any]) -> date | None:
    m = row.get("metadata")
    if m is None and "chunk_metadata" in row:
        m = row.get("chunk_metadata")
    if not isinstance(m, dict):
        m = {}
    for k in (
        "timestamp",
        "ts_utc",
        "filed_at",
        "filed_at_utc",
        "period_end",
        "as_of",
        "as_of_utc",
        "end_date",
    ):
        if k in m and m[k] is not None:
            d = _parse_doc_date(m[k])
            if d is not None:
                return d
    return None


def _filter_chunks_by_metadata_window(
    chunks: list[dict[str, Any]], start: str, end: str
) -> list[dict[str, Any]]:
    if not (start and end):
        return chunks
    try:
        d0 = date.fromisoformat(start[:10])
        d1 = date.fromisoformat(end[:10])
    except ValueError:
        return chunks
    if d0 > d1:
        d0, d1 = d1, d0
    out: list[dict[str, Any]] = []
    for c in chunks:
        ts = _metadata_timestamp(c)
        if ts is None:
            out.append(c)
            continue
        if d0 <= ts <= d1:
            out.append(c)
    return out


def filter_chunks_by_metadata_window(
    chunks: list[dict[str, Any]], start: str, end: str
) -> list[dict[str, Any]]:
    """Keep chunks whose metadata timestamp lies in ``[start, end]`` (inclusive ISO dates)."""
    return _filter_chunks_by_metadata_window(chunks, start, end)


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

_stub_sql_i = 0


async def _stub_sql(_sql: str) -> dict[str, Any]:
    global _stub_sql_i
    _stub_sql_i += 1
    if _stub_sql_i % 2 == 1:
        return {"summary": "stub baseline", "rows": [{"v": 100.0}]}
    return {"summary": "stub new", "rows": [{"v": 112.5}]}


async def _stub_embed(_q: str) -> list[float]:
    return [0.0] * 4


async def _stub_retrieve(
    _emb: list[float],
    **kwargs: Any,
) -> list[dict[str, Any]]:
    return [
        {
            "source": "stub-transcript",
            "content": "Management cited stronger demand in the comparison period.",
            "metadata": {"timestamp": "2026-07-15", "doc_type": "earnings_transcript"},
        }
    ]


@dataclass
class StubTemporalConfig:
    """Build a :class:`TemporalAgentConfig` with stubs for local tests."""

    split_llm: BaseChatModel
    narrative_llm: BaseChatModel
    run_sql: Callable[[str], Awaitable[dict[str, Any]]] | None = None
    embed_query: Callable[[str], Awaitable[list[float]]] | None = None
    retrieve: Any | None = None
    schema_context: str = ""

    def to_temporal_config(self) -> TemporalAgentConfig:
        return TemporalAgentConfig(
            split_llm=self.split_llm,
            narrative_llm=self.narrative_llm,
            run_sql=self.run_sql or _stub_sql,
            embed_query=self.embed_query or _stub_embed,
            retrieve=self.retrieve or _stub_retrieve,
            schema_context=self.schema_context,
        )
