"""
RAG pipeline: Supabase Vector retrieval (earnings transcripts, SEC filings) and
hybrid synthesis that combines SQL results with retrieved text.

Responses always attach a :class:`HybridSources` object linking the SQL used and
RAG document metadata, independent of the LLM narrative.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, NotRequired, Protocol, TypedDict

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Synthesis: trend rule + required sources shape
# ---------------------------------------------------------------------------

HYBRID_SYNTHESIS_SYSTEM = """You are a senior sell-side / FP&A research assistant for
Aequitas FI. You receive (1) tabular or numeric output from a SQL report and
(2) retrieved passages from **earnings call transcripts** and **SEC filings**
(vector search over a Supabase/Postgres `pgvector` store).

Narrative rule (mandatory when applicable):
- **If the SQL result indicates a trend or material change in the numbers
  (e.g. revenue down 10%, margin compression, or other directional moves), use
  the RAG context to look for **specific language** that explains that pattern.
  **Actively look for and tie your explanation to** passages that use or
  relate to keywords such as **'decline'**, **'headwinds'**, or **'supply
  chain'** (and close synonyms) when they help explain the figure — but only
  when such language is **present in the RAG context**; do not invent
  management commentary.

Citations:
- Ground statements in the provided SQL rows and RAG chunks. If context is
  thin, state that clearly.
- The system will always attach a structured **sources** object; align your
  narrative with the documents listed there, but the UI sources are
  system-built from the query and retrievals.

Style: precise, professional, and concise. No fabricated numbers."""


class SynthesisPiiGuard(Protocol):
    """Optional scrub/restore around hybrid synthesis (implemented in the server layer)."""

    def redact_for_synthesis(self, text: str) -> str:
        """Return prompt text safe to send to a cloud LLM."""
        ...

    def restore_answer(self, text: str) -> str:
        """Map model output placeholders back to original values."""
        ...


# ---------------------------------------------------------------------------
# Pydantic: every outward-facing AI payload includes `sources`
# ---------------------------------------------------------------------------


class DocumentSourceItem(BaseModel):
    """One retrieved chunk (transcript or filing) for provenance."""

    id: str | None = None
    source: str
    content_preview: str = Field(
        default="",
        description="Short leading snippet; full text stays in the store",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)
    similarity: float | None = None


class HybridSources(BaseModel):
    """
    Provenance: SQL text used to produce the table + RAG document metadata.
    This object is always populated by the pipeline (not only by the model).
    """

    sql_query: str | None = None
    documents: list[DocumentSourceItem] = Field(default_factory=list)
    # Optional: high-level document kinds represented in the batch
    doc_types: list[str] = Field(
        default_factory=list,
        description="E.g. earnings_transcript, sec_filing",
    )


class HybridSynthesisResult(BaseModel):
    """Model reply plus mandatory sources (built deterministically from inputs)."""

    answer: str
    sources: HybridSources


# ---------------------------------------------------------------------------
# State for LangGraph / orchestration
# ---------------------------------------------------------------------------


class HybridRagState(TypedDict, total=False):
    user_query: str
    query_embedding: list[float] | None
    generated_sql: str | None
    sql_result_rows: list[dict[str, Any]] | None
    retrieved_chunks: list[dict[str, Any]]
    hybrid_answer: str | None
    sources: dict[str, Any]  # JSON-serializable HybridSources


# ---------------------------------------------------------------------------
# Supabase Vector retrieval
# ---------------------------------------------------------------------------


@dataclass
class SupabaseRagConfig:
    """Client config for :class:`SupabaseRagRetriever`."""

    supabase_url: str
    supabase_key: str
    # Postgres RPC: (query_embedding, match_count, source_filter) -> setof document rows
    match_rpc: str = "match_rag_chunks"
    # Metadata keys used to mark transcript vs. SEC — optional filter
    default_match_count: int = 8
    # Optional: restrict to subpaths of `source` (e.g. "transcript/", "filing/")
    source_prefixes: list[str] | None = field(default=None)


@dataclass
class SupabaseRagRetriever:
    r"""
    Semantic search via **Supabase PostgREST** (Vector / ``pgvector``). Calls
    ``POST {SUPABASE_URL}/rest/v1/rpc/{match_rpc}`` with the project API key.
    The RPC (default ``match_rag_chunks``) should return JSON rows with at
    least ``id``, ``source``, ``content``, and ``metadata`` (or
    ``chunk_metadata``) plus optional ``similarity``. Optional request fields
    ``metadata_time_start`` and ``metadata_time_end`` (ISO dates) may be used
    to restrict matches by document metadata; if your RPC ignores them, use
    :func:`aequitas_ai.agents.filter_chunks_by_metadata_window` on the result.

    Example function (align ``vector(…)`` to your embedding model, e.g. 1536):

    ```sql
    create or replace function public.match_rag_chunks(
      query_embedding vector(1536),
      match_count int,
      source_filter text[] default null
    ) returns setof public.document_embeddings
    language sql stable as $$
      select d.*, 1 - (d.embedding <=> query_embedding) as similarity
      from public.document_embeddings d
      where d.embedding is not null
        and (source_filter is null or d.source = any (source_filter))
      order by d.embedding <-> query_embedding
      limit match_count
    $$;
    ```
    """

    config: SupabaseRagConfig

    def _rpc_url(self) -> str:
        base = self.config.supabase_url.rstrip("/")
        return f"{base}/rest/v1/rpc/{self.config.match_rpc}"

    def _rest_headers(self) -> dict[str, str]:
        k = self.config.supabase_key
        return {
            "apikey": k,
            "Authorization": f"Bearer {k}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }

    async def retrieve(
        self,
        query_embedding: list[float],
        match_count: int | None = None,
        *,
        metadata_time_start: str | None = None,
        metadata_time_end: str | None = None,
    ) -> list[dict[str, Any]]:
        n = match_count or self.config.default_match_count
        body: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": n,
        }
        if self.config.source_prefixes is not None:
            body["source_filter"] = self.config.source_prefixes
        # Optional: RPC can filter on document metadata (e.g. `timestamp` between bounds).
        if metadata_time_start is not None:
            body["metadata_time_start"] = metadata_time_start
        if metadata_time_end is not None:
            body["metadata_time_end"] = metadata_time_end
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                self._rpc_url(),
                headers=self._rest_headers(),
                json=body,
            )
        r.raise_for_status()
        data = r.json()
        if not data:
            return []
        if isinstance(data, list):
            return [dict(x) for x in data]
        if isinstance(data, dict):
            return [dict(data)]
        return []


# ---------------------------------------------------------------------------
# Building sources and synthesis
# ---------------------------------------------------------------------------


def _preview(text: str, n: int = 280) -> str:
    t = text.replace("\n", " ").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def _rows_to_context(rows: list[dict[str, Any]] | None, max_rows: int = 50) -> str:
    if not rows:
        return "(no SQL rows returned)"
    lines = [json.dumps(r, default=str) for r in rows[:max_rows]]
    if len(rows) > max_rows:
        lines.append(f"... ({len(rows) - max_rows} more rows omitted)")
    return "\n".join(lines)


def _trend_nudge_for_prompt(sql_text: str, rows: list[dict[str, Any]] | None) -> str:
    """
    If numeric output looks like a headwind, remind the model to use RAG keywords
    (decline, headwinds, supply chain) per product rule. Heuristic, not
    LaTeX-formal: we flag likely trend language in serialized rows/SQL.
    """
    blob = f"{sql_text} {_rows_to_context(rows)[:2000]}"
    if re.search(
        r"(?i)(down|decrease|declin|contraction|headwind|weaker|soft|"
        r"-\s*\d|%\s*-\s*|\bloss\b)",
        blob,
    ):
        return (
            "Context hint: the SQL context suggests a **trend or deterioration**. "
            "In the RAG passages, **prioritize** language connected to *decline*, "
            "*headwinds*, *supply chain* (or close synonyms) when it explains the "
            "number — only if such wording appears in the RAG text."
        )
    return ""


def build_hybrid_sources(
    *,
    sql_query: str | None,
    retrieved: list[dict[str, Any]],
) -> HybridSources:
    """
    **Deterministically** construct ``sources`` so every response includes the
    SQL string and one entry per RAG match with document metadata.
    """
    items: list[DocumentSourceItem] = []
    kinds: set[str] = set()
    for r in retrieved:
        meta = r.get("metadata")
        if meta is None and "chunk_metadata" in r:
            meta = r.get("chunk_metadata")
        if not isinstance(meta, dict):
            meta = dict(meta) if meta else {}
        d_type = (
            meta.get("doc_type")
            or meta.get("document_type")
            or meta.get("filing_type")
        )
        if isinstance(d_type, str) and d_type:
            kinds.add(d_type)
        else:
            src = str(r.get("source", ""))
            if src:
                if re.search(
                    r"(?i)transcript|earnings|call|guidance|prepared|remarks", src
                ):
                    kinds.add("earnings_transcript")
                if re.search(
                    r"(?i)\b(10-?K|10-?Q|8-?K|filing|SEC|edgar|exhibit|md&a|mda)\b",
                    src,
                ) or re.search(
                    r"(?i)sec[_/]|/filings/|/sec/", src
                ):
                    kinds.add("sec_filing")
        items.append(
            DocumentSourceItem(
                id=str(r.get("id", "")) or None,
                source=str(r.get("source", "unknown")),
                content_preview=_preview(str(r.get("content", ""))),
                metadata=meta,
                similarity=(float(s) if (s := r.get("similarity")) is not None else None),
            )
        )
    return HybridSources(
        sql_query=sql_query,
        documents=items,
        doc_types=sorted(kinds),
    )


async def run_hybrid_synthesis(
    *,
    user_query: str,
    generated_sql: str | None,
    sql_result_rows: list[dict[str, Any]] | None,
    retrieved_chunks: list[dict[str, Any]],
    synthesis_llm: BaseChatModel,
    pii_guard: SynthesisPiiGuard | None = None,
) -> HybridSynthesisResult:
    """
    One hybrid synthesis call: tabular SQL output + RAG chunks → narrative.
    :class:`HybridSources` is always filled from the arguments (not the LLM).
    """
    ctx_sql = _rows_to_context(sql_result_rows)
    ctx_rag = "\n\n---\n\n".join(
        f"SOURCE: {c.get('source', '')}\nMETADATA: {c.get('metadata') or c.get('chunk_metadata', {})}\n"
        f"TEXT:\n{c.get('content', '')}"
        for c in (retrieved_chunks or [])
    ) or "(no RAG context retrieved — say so in the answer if relevant)"
    nudge = _trend_nudge_for_prompt((generated_sql or ""), sql_result_rows or [])

    human = (
        f"User question:\n{user_query}\n\n"
        f"SQL used (read-only, for provenance; do not repeat as raw SQL in full):\n{generated_sql or 'N/A'}\n\n"
        f"SQL result rows (machine-readable lines):\n{ctx_sql}\n\n"
    )
    if nudge:
        human += f"{nudge}\n\n"
    human += f"RAG context (earnings + SEC, vector-retrieved chunks):\n{ctx_rag}\n"
    if pii_guard is not None:
        human = pii_guard.redact_for_synthesis(human)
    msg = [SystemMessage(content=HYBRID_SYNTHESIS_SYSTEM), HumanMessage(content=human)]
    res = await synthesis_llm.ainvoke(msg)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        text = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    else:
        text = str(raw)
    if pii_guard is not None:
        text = pii_guard.restore_answer(text)

    src = build_hybrid_sources(
        sql_query=generated_sql,
        retrieved=retrieved_chunks,
    )
    return HybridSynthesisResult(answer=text.strip(), sources=src)


# ---------------------------------------------------------------------------
# High-level: retrieve + synthesize
# ---------------------------------------------------------------------------


@dataclass
class RAGPipelineConfig:
    """Ties retriever, optional embedder, and LLM for end-to-end runs."""

    retriever: SupabaseRagRetriever
    synthesis_llm: BaseChatModel
    embed_query: Callable[[str], Awaitable[list[float]]] | None = None
    pii_guard: SynthesisPiiGuard | None = None


async def run_rag_hybrid(
    config: RAGPipelineConfig,
    user_query: str,
    query_embedding: list[float] | None,
    generated_sql: str | None,
    sql_result_rows: list[dict[str, Any]] | None,
) -> HybridSynthesisResult:
    """
    Full path: (optional) precomputed **query_embedding** → Supabase match RPC →
    :func:`run_hybrid_synthesis`. If ``query_embedding`` is **None** and
    ``config.embed_query`` is set, it is derived from **user_query**.
    """
    emb = query_embedding
    if emb is None and config.embed_query is not None:
        emb = await config.embed_query(user_query)
    if emb is None:
        raise ValueError("Provide query_embedding or config.embed_query")
    raw = await config.retriever.retrieve(emb)
    return await run_hybrid_synthesis(
        user_query=user_query,
        generated_sql=generated_sql,
        sql_result_rows=sql_result_rows,
        retrieved_chunks=raw,
        synthesis_llm=config.synthesis_llm,
        pii_guard=config.pii_guard,
    )


# ---------------------------------------------------------------------------
# LangGraph-style Hybrid Synthesis node
# ---------------------------------------------------------------------------


@dataclass
class HybridSynthesisNodeConfig:
    """Inject LLM; sources are still assembled in the node implementation."""

    synthesis_llm: BaseChatModel
    # If state includes query_embedding, embedder is optional
    embed_query: Callable[[str], Awaitable[list[float]]] | None = None
    # When retriever is None, the node only synthesizes (caller must set retrieved_chunks)
    retriever: SupabaseRagRetriever | None = None
    pii_guard: SynthesisPiiGuard | None = None


def make_hybrid_synthesis_node(
    node_config: HybridSynthesisNodeConfig,
) -> Callable[[HybridRagState], Awaitable[dict[str, Any]]]:
    """
    Returns an async function suitable for ``StateGraph.add_node`` that:
    1. Fetches RAG rows when **query_embedding** is present and a retriever is
       configured, else uses **retrieved_chunks** on the state.
    2. Calls :func:`run_hybrid_synthesis` and returns **hybrid_answer** and
       **sources** (dict) on the state.
    """

    async def hybrid_synthesis_node(state: HybridRagState) -> dict[str, Any]:
        uq = state.get("user_query", "")
        sql_q = state.get("generated_sql")
        rows = state.get("sql_result_rows")
        chunks: list[dict[str, Any]] = list(
            state.get("retrieved_chunks")
            or []
        )
        if not chunks and node_config.retriever is not None:
            emb = state.get("query_embedding")
            if emb is None and node_config.embed_query is not None:
                emb = await node_config.embed_query(uq)
            if emb is not None:
                chunks = await node_config.retriever.retrieve(emb)
        res = await run_hybrid_synthesis(
            user_query=uq,
            generated_sql=sql_q,
            sql_result_rows=rows,
            retrieved_chunks=chunks,
            synthesis_llm=node_config.synthesis_llm,
            pii_guard=node_config.pii_guard,
        )
        return {
            "retrieved_chunks": chunks,
            "hybrid_answer": res.answer,
            "sources": res.sources.model_dump(),
        }

    return hybrid_synthesis_node
