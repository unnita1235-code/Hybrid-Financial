from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

_TRIAGE_SYSTEM_PROMPT = (
    "You are a financial risk analyst. Given this anomaly alert, respond with JSON only: "
    "{severity: 'low'|'medium'|'high'|'critical', summary: str, suggested_action: str, "
    "key_catalysts: [str]}"
)

_SEVERITY_ALLOWED = {"low", "medium", "high", "critical"}


def _strip_json_fence(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): _jsonable(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    return v


def _notification_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _jsonable(v) for k, v in row.items()}


async def list_alerts(
    engine: AsyncEngine,
    user_id: str | None,
    unread_only: bool = True,
    limit: int = 50,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 200))
    sql = text(
        """
        SELECT id, user_id, kind, title, body, z_score, payload, read_at, created_at
        FROM notifications
        WHERE (user_id::text = :user_id OR user_id IS NULL)
          AND (:unread_only = false OR read_at IS NULL)
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )
    async with engine.connect() as conn:
        res = await conn.execute(
            sql,
            {
                "user_id": str(user_id or ""),
                "unread_only": bool(unread_only),
                "limit": safe_limit,
            },
        )
        rows = res.mappings().all()
    return [_notification_row_to_dict(dict(r)) for r in rows]


async def mark_read(engine: AsyncEngine, alert_id: str, user_id: str | None) -> bool:
    now = datetime.now(UTC)
    sql = text(
        """
        UPDATE notifications
        SET read_at = :read_at
        WHERE id = CAST(:alert_id AS uuid)
          AND (user_id::text = :user_id OR user_id IS NULL)
          AND read_at IS NULL
        """
    )
    async with engine.begin() as conn:
        res = await conn.execute(
            sql,
            {
                "alert_id": alert_id,
                "user_id": str(user_id or ""),
                "read_at": now,
            },
        )
        return (res.rowcount or 0) > 0


def _build_triage_prompt(alert: dict[str, Any]) -> str:
    payload = alert.get("payload") if isinstance(alert.get("payload"), dict) else {}
    z_score = payload.get("z_score_used", alert.get("z_score"))
    news_items = (
        ((payload.get("external_catalysts") or {}).get("news") or [])
        if isinstance(payload, dict)
        else []
    )
    filings = (
        ((payload.get("external_catalysts") or {}).get("internal_filings_rag") or [])
        if isinstance(payload, dict)
        else []
    )

    headlines: list[str] = []
    for item in news_items[:8]:
        if isinstance(item, dict):
            t = str(item.get("title") or "").strip()
            if t:
                headlines.append(t)

    filing_excerpts: list[str] = []
    for item in filings[:5]:
        if isinstance(item, dict):
            excerpt = str(item.get("content") or "").strip()
            if excerpt:
                filing_excerpts.append(excerpt[:600])

    sections = [
        f"Title: {alert.get('title') or ''}",
        f"Body: {alert.get('body') or ''}",
        f"Z score: {z_score!s}",
        "News headlines:",
    ]
    if headlines:
        sections.extend([f"- {h}" for h in headlines])
    else:
        sections.append("- none")
    sections.append("Filing excerpts:")
    if filing_excerpts:
        sections.extend([f"- {e}" for e in filing_excerpts])
    else:
        sections.append("- none")
    return "\n".join(sections)


def _parse_triage_response(raw: Any) -> dict[str, Any]:
    content = getattr(raw, "content", raw)
    if isinstance(content, list):
        content = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
        )
    payload = _strip_json_fence(str(content))
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502, detail=f"Triage model returned invalid JSON: {e}"
        ) from e

    severity = str(data.get("severity") or "").strip().lower()
    if severity not in _SEVERITY_ALLOWED:
        raise HTTPException(
            status_code=502,
            detail="Triage model returned invalid severity.",
        )

    key_catalysts_raw = data.get("key_catalysts")
    key_catalysts: list[str]
    if isinstance(key_catalysts_raw, list):
        key_catalysts = [str(x).strip() for x in key_catalysts_raw if str(x).strip()]
    else:
        key_catalysts = []

    return {
        "severity": severity,
        "summary": str(data.get("summary") or "").strip(),
        "suggested_action": str(data.get("suggested_action") or "").strip(),
        "key_catalysts": key_catalysts,
    }


async def triage_alert(
    engine: AsyncEngine,
    llm: BaseChatModel,
    alert_id: str,
) -> dict[str, Any]:
    sql = text(
        """
        SELECT id, user_id, kind, title, body, z_score, payload, read_at, created_at
        FROM notifications
        WHERE id = CAST(:alert_id AS uuid)
        LIMIT 1
        """
    )
    async with engine.connect() as conn:
        res = await conn.execute(sql, {"alert_id": alert_id})
        row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found.")

    alert = _notification_row_to_dict(dict(row))
    prompt = _build_triage_prompt(alert)
    out = await llm.ainvoke(
        [
            SystemMessage(content=_TRIAGE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ]
    )
    return _parse_triage_response(out)


async def get_unread_count(engine: AsyncEngine, user_id: str | None) -> int:
    sql = text(
        """
        SELECT count(*)::int AS unread
        FROM notifications
        WHERE (user_id::text = :user_id OR user_id IS NULL)
          AND read_at IS NULL
        """
    )
    async with engine.connect() as conn:
        res = await conn.execute(sql, {"user_id": str(user_id or "")})
        row = res.mappings().first()
    return int((row or {}).get("unread") or 0)
