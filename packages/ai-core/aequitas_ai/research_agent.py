r"""
**Research agent** (LangGraph): plan → parallel SQL + RAG per sub-question → synthesis.

# Confidence & discrepancy

If **SQL-derived facts** and **RAG (document) findings** are **in tension**
(e.g. different direction on leverage, opposite trends), the graph sets
``discrepancy_warning`` for the UI and **caps** the numeric confidence. The
synthesis LLM is instructed to surface this; a light heuristic is also
applied as a back-up signal.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, NotRequired, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# State & I/O
# ---------------------------------------------------------------------------


class ResearchAgentState(TypedDict, total=False):
    user_query: str
    sub_questions: list[str]
    per_sub: list[dict[str, Any]]
    executive_summary: str
    """Structured one-pager: bullets, numbers, and caveats."""
    confidence_score: float
    """$[0,1]$, lowered when SQL/RAG conflict."""
    discrepancy_warning: bool
    """``True`` when SQL tabular and RAG narrative contradict each other (UI flag)."""
    error: str | None


class ResearchOutputUI(BaseModel):
    """Convenience shape for a dashboard (badge + summary + confidence)."""

    executive_summary: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    discrepancy_warning: bool
    sub_questions: list[str] = Field(default_factory=list)
    per_sub: list[dict[str, Any]] = Field(default_factory=list)


def to_research_output_ui(state: ResearchAgentState) -> ResearchOutputUI:
    """Map final graph state to a Pydantic model for the API/UI layer."""
    return ResearchOutputUI(
        executive_summary=str(state.get("executive_summary", "")),
        confidence_score=float(state.get("confidence_score") or 0.0),
        discrepancy_warning=bool(state.get("discrepancy_warning", False)),
        sub_questions=list(state.get("sub_questions") or []),
        per_sub=list(state.get("per_sub") or []),
    )


# ---------------------------------------------------------------------------
# Config & prompts
# ---------------------------------------------------------------------------


@dataclass
class ResearchAgentConfig:
    plan_llm: BaseChatModel
    synthesize_llm: BaseChatModel
    # Async: given a sub-question, return a short string summary of SQL + optional rows
    run_sql: Callable[[str], Awaitable[dict[str, Any]]]
    # Async: given a sub-question, return RAG chunk list
    run_rag: Callable[[str], Awaitable[list[dict[str, Any]]]]


PLAN_SYSTEM = """You are a financial research planner for Aequitas FI.
Given a complex user question, decompose it into **exactly 3** distinct,
answerable sub-questions about debt, interest / rates, liquidity, or related
analyst/company topics as appropriate. Each should be a single, clear
question. Output JSON only:
{ "sub_questions": [ "<Q1>", "<Q2>", "<Q3>" ] }"""

SYNTHESIZE_SYSTEM = """You are a buy-side / credit research lead.
You will receive: (1) a user request, (2) three sub-questions, and for each
sub-question, **SQL/structured** findings and **RAG / document** excerpts.

**Produce a structured Executive Summary** in Markdown with short sections:
- **Key takeaways** (2–3 bullets)
- **By sub-question** (brief under each of the 3)
- **Risks & gaps**

Also output a **confidence** number in $[0,1]$ (JSON field ``confidence``)

**CRITICAL – discrepancy rule:**
- If the **SQL/tabular** evidence and the **RAG text** for the **same
  sub-question** (or in aggregate) support **incompatible** conclusions
  (e.g. SQL shows debt/liquidity one way, filings language implies the
  opposite; or revenue trend in SQL vs. "decline" in docs without alignment),
  you MUST set **discrepancy_warning: true** and **lower confidence** (do
  not exceed 0.45 if there is a clear conflict). If sources align, you may use
  higher confidence.

**Output JSON only** with keys:
- executive_summary: string (the Markdown, escaped as needed in JSON)
- confidence: number in [0,1]
- discrepancy_warning: boolean
Do not add other top-level keys."""


# ---------------------------------------------------------------------------
# LLM I/O
# ---------------------------------------------------------------------------


def _strip_json_block(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```$", "", t)
    return t


async def _plan_subquestions(llm: BaseChatModel, user_query: str) -> list[str]:
    m = [SystemMessage(content=PLAN_SYSTEM), HumanMessage(content=f"User question:\n{user_query}")]
    res = await llm.ainvoke(m)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    data = json.loads(_strip_json_block(str(raw)))
    subs = data.get("sub_questions", [])
    if not isinstance(subs, list) or len(subs) != 3:
        raise ValueError("Planner must return exactly 3 sub_questions in JSON")
    return [str(s).strip() for s in subs[:3]]


async def _synthesize(
    llm: BaseChatModel,
    state: ResearchAgentState,
) -> tuple[str, float, bool]:
    """Return (summary, confidence, discrepancy_warning from the judge LLM)."""
    m = [SystemMessage(content=SYNTHESIZE_SYSTEM), HumanMessage(content=_pack_context(state))]
    res = await llm.ainvoke(m)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    out = json.loads(_strip_json_block(str(raw)))
    summary = str(out.get("executive_summary", ""))
    c = float(out.get("confidence", 0.5))
    c = max(0.0, min(1.0, c))
    disc = bool(out.get("discrepancy_warning", False))
    return summary, c, disc


def _pack_context(s: ResearchAgentState) -> str:
    lines = [f"User request:\n{s.get('user_query', '')}\n"]
    for i, block in enumerate(s.get("per_sub") or []):
        lines.append(f"--- Sub-question {i+1} ---\n{json.dumps(block, default=str)[:15000]}\n")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Heuristic contradiction (back-up to LLM; UI can rely on `discrepancy_warning` ORed)
# ---------------------------------------------------------------------------

_NEG = re.compile(
    r"(?i)\b(deteriorat|downgrade|weaker|declin|increase in debt|covenant|default|illiquid|shortfall)\b"
)
_POS = re.compile(
    r"(?i)\b(strong|improv|de-lever|healthy|ample liquidity|outperform|upgrad)\b"
)


def _heuristic_contradiction(per_sub: list[dict[str, Any]]) -> bool:
    """
    Cheap signal: if for one sub, SQL blurb and RAG blurb look positive/negative
    in opposite ways. Not ground truth—always combine with the LLM flag.
    """
    for p in per_sub or []:
        s_sql = (p.get("sql_summary") or "") + (str(p.get("sql_rows") or ""))
        s_rag = " ".join(
            c.get("content", c.get("text", "")) if isinstance(c, dict) else str(c)
            for c in (p.get("rag_excerpts") or [])
        )
        if not s_sql.strip() or not s_rag.strip():
            continue
        neg_sql = bool(_NEG.search(s_sql)) and not _POS.search(s_sql)
        pos_sql = bool(_POS.search(s_sql)) and not _NEG.search(s_sql)
        neg_r = bool(_NEG.search(s_rag)) and not _POS.search(s_rag)
        pos_r = bool(_POS.search(s_rag)) and not _NEG.search(s_rag)
        if (pos_sql and neg_r) or (neg_sql and pos_r):
            return True
    return False


# ---------------------------------------------------------------------------
# One sub: parallel SQL + RAG
# ---------------------------------------------------------------------------


async def _run_one_sub(
    sq: str,
    run_sql: Callable[[str], Awaitable[dict[str, Any]]],
    run_rag: Callable[[str], Awaitable[list[dict[str, Any]]]],
) -> dict[str, Any]:
    so: dict[str, Any]
    r_rag: list[dict[str, Any]] | str

    try:
        so, r_rag = await asyncio.gather(
            run_sql(sq),
            run_rag(sq),
            return_exceptions=True,
        )
    except Exception as e:  # noqa: BLE001
        return {
            "sub_question": sq,
            "error": str(e),
            "sql_summary": None,
            "sql_rows": [],
            "rag_excerpts": [],
        }
    if isinstance(so, Exception):
        so = {"summary": f"sql error: {so}"}
    if isinstance(r_rag, Exception):
        r_rag = []
    if not isinstance(r_rag, list):
        r_rag = [r_rag] if r_rag else []
    if not isinstance(so, dict):
        so = {"raw": so}
    return {
        "sub_question": sq,
        "sql_summary": so.get("summary") or so.get("raw") or json.dumps(so, default=str)[:4000],
        "sql_rows": so.get("rows") or so.get("data") or [],
        "rag_excerpts": r_rag,
    }


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_research_agent(config: ResearchAgentConfig):
    async def plan_node(s: ResearchAgentState) -> dict[str, Any]:
        try:
            subs = await _plan_subquestions(config.plan_llm, s.get("user_query", ""))
        except Exception as e:  # noqa: BLE001
            return {"error": f"Plan failed: {e}", "sub_questions": []}
        return {"sub_questions": subs, "error": None}

    async def execute_node(s: ResearchAgentState) -> dict[str, Any]:
        qlist = s.get("sub_questions") or []
        if not qlist or len(qlist) != 3:
            return {"per_sub": []}
        results = await asyncio.gather(
            *[
                _run_one_sub(sq, config.run_sql, config.run_rag)
                for sq in qlist
            ]
        )
        return {"per_sub": list(results)}

    async def synthesize_node(s: ResearchAgentState) -> dict[str, Any]:
        if s.get("error") and not s.get("per_sub"):
            return {
                "executive_summary": "Research aborted during planning or execution.",
                "confidence_score": 0.0,
                "discrepancy_warning": False,
            }
        heur = _heuristic_contradiction(s.get("per_sub") or [])
        try:
            ess, conf, disc_llm = await _synthesize(config.synthesize_llm, s)
        except Exception as e:  # noqa: BLE001
            return {
                "executive_summary": f"Synthesis error: {e}",
                "confidence_score": 0.2,
                "discrepancy_warning": heur,
            }
        disc = heur or disc_llm
        if disc and conf > 0.45:
            conf = min(conf, 0.45)
        if heur and not disc_llm:
            conf = min(conf, 0.45)
        return {
            "executive_summary": ess,
            "confidence_score": conf,
            "discrepancy_warning": disc,
        }

    g = StateGraph(ResearchAgentState)
    g.add_node("plan", plan_node)
    g.add_node("execute", execute_node)
    g.add_node("synthesize", synthesize_node)
    g.add_edge(START, "plan")
    g.add_edge("plan", "execute")
    g.add_edge("execute", "synthesize")
    g.add_edge("synthesize", END)
    return g.compile()


# ---------------------------------------------------------------------------
# Stubs (testing / integration without a live DB)
# ---------------------------------------------------------------------------


async def _stub_sql(q: str) -> dict[str, Any]:
    return {
        "summary": f"Stub SQL: would aggregate tables for: {q[:80]}",
        "rows": [{"metric": "stub", "value": 1.0}],
    }


async def _stub_rag(q: str) -> list[dict[str, Any]]:
    return [
        {
            "source": "stub-filing",
            "content": f"Stub RAG context for: {q[:200]} (liquidity discussed favorably in MD&A).",
        }
    ]


@dataclass
class StubResearchConfig:
    """Convenience: build a :class:`ResearchAgentConfig` with default stubs; inject real `run_sql` / `run_rag` for production."""

    plan_llm: BaseChatModel
    synthesize_llm: BaseChatModel
    run_sql: Callable[[str], Awaitable[dict[str, Any]]] | None = None
    run_rag: Callable[[str], Awaitable[list[dict[str, Any]]]] | None = None

    def to_agent_config(self) -> ResearchAgentConfig:
        return ResearchAgentConfig(
            plan_llm=self.plan_llm,
            synthesize_llm=self.synthesize_llm,
            run_sql=self.run_sql or _stub_sql,
            run_rag=self.run_rag or _stub_rag,
        )
