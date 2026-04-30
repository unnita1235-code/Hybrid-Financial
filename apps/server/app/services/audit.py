"""Audit log + human feedback persistence."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from aequitas_database.models.audit_log import AuditLog, HumanFeedback
from sqlalchemy import select, update

from app.db import get_session_maker


def default_model_versions() -> dict[str, str]:
    from app.config import settings

    return {
        "sql_model": settings.sql_model,
        "synthesis_model": settings.synthesis_model,
        "embedding_model": settings.embedding_model,
    }


async def create_session(
    *,
    user_id: str | None,
    user_role: str,
    prompt_template: str,
    user_query: str | None,
) -> uuid.UUID:
    sm = get_session_maker()
    log_id = uuid.uuid4()
    now = datetime.now(UTC)
    async with sm() as session:
        row = AuditLog(
            id=log_id,
            user_id=user_id,
            user_role=user_role[:32],
            prompt_template=prompt_template,
            user_query=user_query,
            generated_sql=None,
            rag_chunks=None,
            model_versions=default_model_versions(),
            final_narrative=None,
            status="open",
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        await session.commit()
    return log_id


async def complete_session(
    log_id: uuid.UUID,
    *,
    final_narrative: str | None,
    generated_sql: str | None,
    rag_chunks: list[dict[str, Any]] | None,
    model_versions: dict[str, str] | None,
) -> None:
    sm = get_session_maker()
    now = datetime.now(UTC)
    mv = {**default_model_versions(), **(model_versions or {})}
    async with sm() as session:
        await session.execute(
            update(AuditLog)
            .where(AuditLog.id == log_id)
            .values(
                final_narrative=final_narrative,
                generated_sql=generated_sql,
                rag_chunks=rag_chunks,
                model_versions=mv,
                status="completed",
                updated_at=now,
            )
        )
        await session.commit()


async def add_feedback(
    log_id: uuid.UUID,
    *,
    vote: int,
    correction_text: str | None,
) -> uuid.UUID:
    if vote not in (1, -1):
        raise ValueError("vote must be 1 (up) or -1 (down)")
    sm = get_session_maker()
    fid = uuid.uuid4()
    async with sm() as session:
        session.add(
            HumanFeedback(
                id=fid,
                audit_log_id=log_id,
                vote=vote,
                correction_text=correction_text,
            )
        )
        await session.commit()
    return fid


async def get_session_row(log_id: uuid.UUID) -> AuditLog | None:
    sm = get_session_maker()
    async with sm() as session:
        r = await session.execute(select(AuditLog).where(AuditLog.id == log_id))
        return r.scalars().first()
