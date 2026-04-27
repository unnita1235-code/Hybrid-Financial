from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.auth.identity import get_identity
from app.config import settings
from app.services import alert_svc

router = APIRouter(prefix="/v1/alerts", tags=["alerts"])


class AlertsCountResponse(BaseModel):
    unread: int


class MarkReadResponse(BaseModel):
    ok: bool


class AlertTriageResponse(BaseModel):
    severity: str
    summary: str
    suggested_action: str
    key_catalysts: list[str]


@lru_cache
def _alerts_engine() -> AsyncEngine:
    return create_async_engine(settings.database_url, pool_pre_ping=True, echo=False)


def _triage_llm() -> BaseChatModel:
    model = (settings.alert_triage_model or "claude-3-5-sonnet-20241022").strip()
    if model.startswith("claude"):
        if settings.anthropic_api_key:
            return ChatAnthropic(
                model=model,
                temperature=0,
                api_key=settings.anthropic_api_key,
            )
        if settings.openai_api_key:
            return ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0,
                api_key=settings.openai_api_key,
            )
        raise HTTPException(
            status_code=503,
            detail="Set ANTHROPIC_API_KEY or OPENAI_API_KEY for alert triage.",
        )
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required for non-Claude alert triage models.",
        )
    return ChatOpenAI(
        model=model,
        temperature=0,
        api_key=settings.openai_api_key,
    )


@router.get("")
async def get_alerts(
    request: Request,
    unread_only: bool = Query(True),
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    ident = await get_identity(request)
    return await alert_svc.list_alerts(
        _alerts_engine(),
        user_id=ident.sub,
        unread_only=unread_only,
        limit=limit,
    )


@router.get("/count", response_model=AlertsCountResponse)
async def get_alert_count(request: Request) -> AlertsCountResponse:
    ident = await get_identity(request)
    unread = await alert_svc.get_unread_count(_alerts_engine(), user_id=ident.sub)
    return AlertsCountResponse(unread=unread)


@router.patch("/{alert_id}/read", response_model=MarkReadResponse)
async def patch_alert_read(request: Request, alert_id: str) -> MarkReadResponse:
    ident = await get_identity(request)
    ok = await alert_svc.mark_read(_alerts_engine(), alert_id=alert_id, user_id=ident.sub)
    return MarkReadResponse(ok=ok)


@router.post("/{alert_id}/triage", response_model=AlertTriageResponse)
async def post_alert_triage(request: Request, alert_id: str) -> AlertTriageResponse:
    ident = await get_identity(request)
    async with _alerts_engine().connect() as conn:
        access = await conn.execute(
            text(
                """
                SELECT 1
                FROM notifications
                WHERE id = CAST(:alert_id AS uuid)
                  AND (user_id::text = :user_id OR user_id IS NULL)
                LIMIT 1
                """
            ),
            {"alert_id": alert_id, "user_id": str(ident.sub or "")},
        )
        allowed = access.scalar_one_or_none()
    if allowed is None:
        raise HTTPException(status_code=404, detail="Alert not found.")
    result = await alert_svc.triage_alert(
        _alerts_engine(),
        llm=_triage_llm(),
        alert_id=alert_id,
    )
    return AlertTriageResponse(**result)
