"""
RAG pipeline: Postgres pgvector retrieval (earnings transcripts, SEC filings) and
hybrid synthesis that combines SQL results with retrieved text.

Responses always attach a :class:`HybridSources` object linking the SQL used and
RAG document metadata, independent of the LLM narrative.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Synthesis: trend rule + required sources shape
# ---------------------------------------------------------------------------

HYBRID_SYNTHESIS_SYSTEM = """You are a senior sell-side / FP&A research assistant for
Aequitas FI. You receive (1) tabular or numeric output from a SQL report and
(2) retrieved passages from **earnings call transcripts** and **SEC filings**
(vector search over the application Postgres `pgvector` store).

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
# Postgres pgvector retrieval (Render PostgreSQL, direct database access)
# ---------------------------------------------------------------------------


@dataclass
class PostgresRagConfig:
    """Client config for :class:`PostgresRagRetriever`."""

    # Optional: restrict to subpaths of `source` (e.g. "transcript/", "filing/")
    source_prefixes: list[str] | None = field(default=None)
    default_match_count: int = 8
    max_match_count: int = 100


def merge_rrf(
    results_a: list[dict],
    results_b: list[dict],
    k: int = 60,
    id_key: str = "id",
) -> list[dict]:
    """Reciprocal Rank Fusion merge. Pure function, no I/O."""
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}
    for rank, item in enumerate(results_a, start=1):
        key = str(item[id_key])
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        items[key] = item
    for rank, item in enumerate(results_b, start=1):
        key = str(item[id_key])
        scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
        items[key] = item
    ranked = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
    return [items[key] for key in ranked]


@dataclass
class PostgresRagRetriever:
    r"""
    Semantic search directly against PostgreSQL ``pgvector`` (no hosted
    vector service). Runs cosine-distance search over
    ``public.document_embeddings`` using the HNSW index.

    ``session_factory`` is a zero-argument callable returning an async
    SQLAlchemy session usable as an async context manager (e.g. an
    ``async_sessionmaker`` instance). A fresh session is opened per call.

    Returns rows shaped as ``{"id", "source", "content", "chunk_metadata",
    "distance"}``. Optional ``metadata_time_start`` / ``metadata_time_end``
    keyword arguments are accepted for interface compatibility and left for
    callers to enforce via :func:`filter_chunks_by_metadata_window`, matching
    the previous transport behavior.
    """

    session_factory: Callable[[], Any]
    config: PostgresRagConfig = field(default_factory=PostgresRagConfig)

    def _vector_literal(self, query_embedding: list[float]) -> str:
        return "[" + ",".join(repr(float(x)) for x in query_embedding) + "]"

    def _vector_query(self, with_prefixes: bool):  # type: ignore[no-untyped-def]
        from sqlalchemy import text as sa_text

        prefix_filter = (
            "AND source = ANY(:prefixes)\n        " if with_prefixes else ""
        )
        return sa_text(
            "SELECT id::text AS id, source, content, chunk_metadata,\n"
            "       (embedding <=> CAST(:emb AS vector)) AS distance\n"
            "FROM document_embeddings\n"
            "WHERE embedding IS NOT NULL\n"
            f"        {prefix_filter}"
            "ORDER BY embedding <=> CAST(:emb AS vector)\n"
            "LIMIT :n"
        )

    @staticmethod
    def _normalize_row(mapping: Any) -> dict[str, Any]:
        meta = mapping.get("chunk_metadata")
        return {
            "id": str(mapping.get("id")),
            "source": str(mapping.get("source") or "unknown"),
            "content": str(mapping.get("content") or ""),
            "chunk_metadata": dict(meta) if isinstance(meta, dict) else {},
            "distance": float(mapping.get("distance") or 0.0),
        }

    async def retrieve(
        self,
        query_embedding: list[float],
        match_count: int | None = None,
        *,
        metadata_time_start: str | None = None,
        metadata_time_end: str | None = None,
    ) -> list[dict[str, Any]]:
        _ = (metadata_time_start, metadata_time_end)
        if not query_embedding:
            return []
        n = match_count or self.config.default_match_count
        n = max(1, min(int(n), self.config.max_match_count))
        use_prefixes = self.config.source_prefixes is not None
        params: dict[str, Any] = {
            "emb": self._vector_literal(query_embedding),
            "n": n,
        }
        if use_prefixes:
            params["prefixes"] = list(self.config.source_prefixes or [])
        async with self.session_factory() as session:
            res = await session.execute(self._vector_query(use_prefixes), params)
            rows = res.mappings().all()
        return [self._normalize_row(dict(r)) for r in rows]

    async def retrieve_hybrid(
        self,
        query: str,
        query_embedding: list[float],
        match_count: int | None = None,
        *,
        metadata_time_start: str | None = None,
        metadata_time_end: str | None = None,
    ) -> list[dict[str, Any]]:
        _ = (metadata_time_start, metadata_time_end)
        n = match_count or self.config.default_match_count
        n = max(1, min(int(n), self.config.max_match_count))

        vector_results = await self.retrieve(
            query_embedding=query_embedding,
            match_count=n,
        )

        fts_results: list[dict[str, Any]] = []
        try:
            from sqlalchemy import text as sa_text

            async with self.session_factory() as session:
                res = await session.execute(
                    sa_text(
                        "SELECT id::text AS id, source, content, chunk_metadata "
                        "FROM match_rag_chunks_fts("
                        "CAST(:q AS text), :n, CAST(:prefixes AS text[]))"
                    ),
                    {
                        "q": query,
                        "n": n,
                        "prefixes": list(self.config.source_prefixes or [])
                        or None,
                    },
                )
                fts_results = [
                    self._normalize_row(dict(r)) for r in res.mappings().all()
                ]
        except Exception as exc:  # noqa: BLE001
            import logging

            logging.getLogger(__name__).warning("FTS search failed: %s", exc)
            return vector_results

        return merge_rrf(vector_results, fts_results, k=60)


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

    retriever: PostgresRagRetriever
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
    Full path: (optional) precomputed **query_embedding** → Postgres vector search →
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
    retriever: PostgresRagRetriever | None = None
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
