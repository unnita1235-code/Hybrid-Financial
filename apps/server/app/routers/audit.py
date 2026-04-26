r"""Audit trail API (sessions, completion, human feedback) + default prompt constant."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.auth.identity import get_identity
from app.rbac.sensitive_sql import assert_sql_rbac
from app.services import audit as audit_service
from app.services.audit import default_model_versions

# Exact template id + short description stored per response (traceability).
INSIGHT_DEMO_PROMPT_ID = "hybrid_synthesis_rag_v1"
INSIGHT_DEMO_PROMPT_DESCRIPTION = r"""[HYBRID_SYNTHESIS_SYSTEM] Sell-side / FP&A assistant; SQL
provenance + RAG from transcripts/SEC. Trend keyword nudge. Citations
mandated from hybrid sources."""


router = APIRouter(prefix="/v1/audit", tags=["audit", "transparency"])


class SessionCreateBody(BaseModel):
    user_query: str | None = None
    prompt_template: str = Field(
        default=INSIGHT_DEMO_PROMPT_ID,
        description="Identifier + optional inline template text; stored verbatim for audit",
    )
    generated_sql: str | None = Field(
        default=None,
        description="Optional: preflight SQL (RBAC) before a stream is allowed",
    )


class SessionCreateResponse(BaseModel):
    id: str
    user_role: str
    user_id: str | None
    default_model_versions: dict[str, str]
    prompt_template: str


@router.post("/sessions", response_model=SessionCreateResponse)
async def open_audit_session(request: Request, body: SessionCreateBody) -> SessionCreateResponse:
    ident = await get_identity(request)
    if body.generated_sql is not None:
        assert_sql_rbac(body.generated_sql, ident.role)
    from app.config import settings

    prompt_text = (body.prompt_template or INSIGHT_DEMO_PROMPT_ID).strip()
    if prompt_text == INSIGHT_DEMO_PROMPT_ID:
        stored_template = f"{INSIGHT_DEMO_PROMPT_ID}\n{INSIGHT_DEMO_PROMPT_DESCRIPTION}"
    else:
        stored_template = prompt_text

    new_id = await audit_service.create_session(
        user_id=ident.sub,
        user_role=ident.role,
        prompt_template=stored_template,
        user_query=body.user_query,
    )
    return SessionCreateResponse(
        id=str(new_id),
        user_role=ident.role,
        user_id=ident.sub,
        default_model_versions=default_model_versions(),
        prompt_template=stored_template,
    )


class SessionCompleteBody(BaseModel):
    final_narrative: str | None = None
    generated_sql: str | None = None
    rag_chunks: list[dict[str, Any]] | None = None
    model_versions: dict[str, str] | None = None


@router.patch("/sessions/{session_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_audit_session(
    request: Request,
    session_id: uuid.UUID,
    body: SessionCompleteBody,
) -> Response:
    ident = await get_identity(request)
    assert_sql_rbac(body.generated_sql, ident.role)
    row = await audit_service.get_session_row(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Unknown audit session")
    if row.user_id and ident.sub and str(row.user_id) != str(ident.sub):
        raise HTTPException(status_code=403, detail="Audit session does not belong to this user")
    await audit_service.complete_session(
        session_id,
        final_narrative=body.final_narrative,
        generated_sql=body.generated_sql,
        rag_chunks=body.rag_chunks,
        model_versions=body.model_versions,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class FeedbackBody(BaseModel):
    audit_log_id: uuid.UUID
    vote: Literal[1, -1]
    correction_text: str | None = None


@router.post(
    "/feedback",
    status_code=status.HTTP_201_CREATED,
)
async def post_feedback(request: Request, body: FeedbackBody) -> dict[str, str]:
    if body.vote == -1 and not (body.correction_text or "").strip():
        raise HTTPException(
            status_code=400,
            detail="correction_text is required when vote is -1 (thumbs down)",
        )
    ident = await get_identity(request)
    row = await audit_service.get_session_row(body.audit_log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Unknown audit id")
    if row.user_id and ident.sub and str(row.user_id) != str(ident.sub):
        raise HTTPException(status_code=403, detail="Cannot add feedback to another user's audit")
    fid = await audit_service.add_feedback(
        body.audit_log_id,
        vote=body.vote,
        correction_text=body.correction_text,
    )
    return {"id": str(fid)}


@router.get("/sessions/{session_id}/summary", response_model=dict)
async def audit_summary(request: Request, session_id: uuid.UUID) -> dict[str, Any]:
    ident = await get_identity(request)
    row = await audit_service.get_session_row(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    if row.user_id and ident.sub and str(row.user_id) != str(ident.sub):
        if ident.role not in ("admin", "superuser"):
            raise HTTPException(status_code=403, detail="Forbidden")
    return {
        "id": str(row.id),
        "user_role": row.user_role,
        "prompt_template": (row.prompt_template or "")[:2000],
        "user_query": row.user_query,
        "generated_sql": row.generated_sql,
        "rag_chunks": row.rag_chunks,
        "model_versions": row.model_versions,
        "final_narrative": (row.final_narrative or "")[:8000] if row.final_narrative else None,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
