"""
Compile the **TemporalAgent** LangGraph with app settings: OpenAI chat + embeddings,
read-only SQL against ``settings.database_url``, and optional Supabase vector RAG.
"""

from __future__ import annotations

from typing import Any

from aequitas_ai import (
    DEFAULT_FINANCIAL_SCHEMA,
    SupabaseRagConfig,
    SupabaseRagRetriever,
    TemporalAgentConfig,
    build_temporal_agent,
)
from aequitas_ai.sql_engine import _is_read_only_select
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph.state import CompiledStateGraph
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings
from middleware.redactor import RedactingChatModel

_compiled: CompiledStateGraph | None = None
_engine: AsyncEngine | None = None
_checkpointer: BaseCheckpointSaver | None = None
_max_sql_rows = 5_000


def set_temporal_checkpointer(checkpointer: BaseCheckpointSaver | None) -> None:
    """Set Postgres (or in-memory) checkpointer and invalidate cached compiled graph."""
    global _compiled, _checkpointer
    _checkpointer = checkpointer
    _compiled = None


def _get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = settings.database_url
        if url.startswith("postgresql+asyncpg"):
            _engine = create_async_engine(
                url,
                pool_pre_ping=True,
                connect_args={
                    "server_settings": {"default_transaction_read_only": "on"}
                },
            )
        else:
            _engine = create_async_engine(url, pool_pre_ping=True)
    return _engine


async def _run_sql_readonly(sql: str) -> dict[str, Any]:
    if not _is_read_only_select(sql):
        return {
            "rows": [],
            "error": "Only a single read-only SELECT/CTE is allowed.",
        }
    stripped = sql.strip().rstrip(";")
    limited = (
        f"SELECT * FROM ({stripped}) AS _aequitas_temporal_subq LIMIT {_max_sql_rows}"
    )
    try:
        async with _get_engine().connect() as conn:
            res = await conn.execute(text(limited))
            rows = [dict(r) for r in res.mappings().all()]
    except Exception as e:  # noqa: BLE001
        return {"rows": [], "error": str(e)}
    return {"rows": rows}


async def _embed_query(q: str) -> list[float]:
    if not settings.openai_api_key:
        msg = "OPENAI_API_KEY is required for embeddings (temporal RAG node)."
        raise RuntimeError(msg)
    emb = OpenAIEmbeddings(
        model=settings.embedding_model,
        api_key=settings.openai_api_key,
    )
    return await emb.aembed_query(q)


def _build_retrieve():
    if not settings.supabase_url or not settings.supabase_service_key:
        async def _empty(
            _emb: list[float], **_kwargs: Any
        ) -> list[dict[str, Any]]:
            return []

        return _empty

    retriever = SupabaseRagRetriever(
        config=SupabaseRagConfig(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_key,
        )
    )

    async def _retrieve(
        query_embedding: list[float],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        return await retriever.retrieve(query_embedding, **kwargs)

    return _retrieve


def _build_config() -> TemporalAgentConfig:
    if not settings.openai_api_key:
        msg = "OPENAI_API_KEY is required for the temporal agent."
        raise RuntimeError(msg)
    # Split uses a cheaper default; narrative may use a stronger model if valid for OpenAI.
    split = ChatOpenAI(
        model=settings.sql_model,
        temperature=0,
        api_key=settings.openai_api_key,
    )
    syn = settings.synthesis_model or ""
    narrative_model = (
        syn
        if syn.startswith(("gpt-", "o1", "o3", "o4"))
        else "gpt-4o-mini"
    )
    narrative_inner = ChatOpenAI(
        model=narrative_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
    )
    narrative: BaseChatModel = (
        RedactingChatModel(bound=narrative_inner)
        if settings.pii_redaction_enabled
        else narrative_inner
    )
    return TemporalAgentConfig(
        split_llm=split,
        narrative_llm=narrative,
        run_sql=_run_sql_readonly,
        embed_query=_embed_query,
        retrieve=_build_retrieve(),
        schema_context=DEFAULT_FINANCIAL_SCHEMA,
    )


def get_temporal_graph() -> CompiledStateGraph:
    """
    Return a **singleton** compiled graph. Requires ``OPENAI_API_KEY`` and will
    raise :class:`RuntimeError` on first build if keys / config are missing.
    When no checkpointer was set (e.g. tests), falls back to in-memory
    :class:`langgraph.checkpoint.memory.MemorySaver`.
    """
    global _compiled
    if _compiled is None:
        cp = _checkpointer
        if cp is None:
            from langgraph.checkpoint.memory import MemorySaver

            cp = MemorySaver()
        _compiled = build_temporal_agent(_build_config(), checkpointer=cp)
    return _compiled


def reset_temporal_graph_for_tests() -> None:
    """Clear cached graph and engine (use in tests only)."""
    global _compiled, _engine
    _compiled = None
    if _engine is not None:
        # caller may dispose; tests typically skip
        _engine = None
