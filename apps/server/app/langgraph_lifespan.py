r"""
Postgres-backed LangGraph checkpointing for the temporal graph.

Falls back to in-memory :class:`MemorySaver` when disabled or on connection failure
(e.g. local dev without Docker).
"""

from __future__ import annotations

import logging
from re import sub
from typing import Any

from app.config import settings
from app.graph.temporal import set_temporal_checkpointer

log = logging.getLogger(__name__)


def _to_psycopg_conninfo(sqlalchemy_url: str) -> str:
    """
    ``postgresql+asyncpg://...`` → ``postgresql://...`` for psycopg3 / langgraph
    checkpoint saver.
    """
    u = sqlalchemy_url.strip()
    if "+asyncpg" in u:
        u = sub(r"^postgresql\+asyncpg", "postgresql", u, count=1)
    if "+psycopg" in u:
        u = sub(r"^postgresql\+psycopg", "postgresql", u, count=1)
    return u


async def _start_postgres_checkpointer() -> Any:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    info = _to_psycopg_conninfo(settings.database_url)
    pool: AsyncConnectionPool[dict[str, Any]] = AsyncConnectionPool(
        conninfo=info,
        open=False,
        min_size=1,
        max_size=10,
    )
    try:
        await pool.open()
        cp = AsyncPostgresSaver(conn=pool)
        await cp.setup()
    except Exception:
        await pool.close()
        raise
    return cp, pool


async def start_langgraph_checkpointer() -> Any | None:
    """
    Configure the temporal graph checkpointer. Returns a cleanup handle
    (connection pool) or ``None`` when using the default in-memory path.
    """
    if not settings.use_postgres_checkpointer:
        set_temporal_checkpointer(None)
        return None
    try:
        saver, pool = await _start_postgres_checkpointer()
        set_temporal_checkpointer(saver)
        log.info("LangGraph checkpointer: PostgreSQL (persistent thread memory).")
        return pool
    except Exception:
        if settings.checkpointer_postgres_required:
            raise
        log.warning(
            "LangGraph Postgres checkpointer unavailable; using in-memory MemorySaver.",
            exc_info=True,
        )
        set_temporal_checkpointer(None)
        return None


async def stop_langgraph_checkpointer(pool: Any | None) -> None:
    set_temporal_checkpointer(None)
    if pool is not None:
        await pool.close()
