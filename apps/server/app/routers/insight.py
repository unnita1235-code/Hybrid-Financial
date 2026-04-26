r"""Hybrid **SQL (LangGraph) + RAG + synthesis** stream (SSE) for the dashboard.

Pairs with the Next.js route ``/api/insight/stream`` which proxies here and
normalizes the same event types as :mod:`app.routers.audit` sessions.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from aequitas_ai import (
    DEFAULT_FINANCIAL_SCHEMA,
    SqlGraphConfig,
    SupabaseRagConfig,
    SupabaseRagRetriever,
    build_hybrid_sources,
    build_sql_engine_graph,
    run_hybrid_synthesis,
)
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from pydantic import BaseModel, Field

from app.auth.identity import get_identity
from app.config import settings
from app.rbac.sensitive_sql import assert_sql_rbac
from app.routers.audit import (
    INSIGHT_DEMO_PROMPT_DESCRIPTION,
    INSIGHT_DEMO_PROMPT_ID,
)
from app.services import audit as audit_service
from app.services.audit import default_model_versions
from middleware.redactor import ContextRedactionPiiGuard, redaction_session

router = APIRouter(prefix="/v1/insight", tags=["insight"])


def _json_default(o: object) -> Any:
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, UUID):
        return str(o)
    raise TypeError(f"Object of type {type(o)} is not JSON serializable")


def _jsonable_row(r: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in r.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _dumps(obj: Any) -> str:
    return json.dumps(obj, default=_json_default)

_insight_sql_graph: Any | None = None
_max_sql_rows = 5_000
_max_rag = 8


class InsightStreamBody(BaseModel):
    query: str = Field(min_length=2, max_length=4_000)


def _get_sql_graph() -> Any:
    global _insight_sql_graph
    if _insight_sql_graph is None:
        if not settings.openai_api_key:
            raise HTTPException(
                status_code=503,
                detail="OPENAI_API_KEY is required for the SQL (Architect) pipeline.",
            )
        llm = ChatOpenAI(
            model=settings.sql_model,
            temperature=0,
            api_key=settings.openai_api_key,
        )
        cfg = SqlGraphConfig(
            architect_llm=llm,
            validator_llm=llm,
            database_url=settings.database_url,
            max_result_rows=_max_sql_rows,
            schema_ddl=DEFAULT_FINANCIAL_SCHEMA,
        )
        _insight_sql_graph = build_sql_engine_graph(cfg)
    return _insight_sql_graph


def _synthesis_llm() -> BaseChatModel:
    m = (settings.synthesis_model or "gpt-4o-mini").strip()
    if m.startswith("claude"):
        if not settings.anthropic_api_key:
            if not settings.openai_api_key:
                raise HTTPException(503, "Set ANTHROPIC_API_KEY or OPENAI_API_KEY for synthesis.")
            return ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0.2,
                api_key=settings.openai_api_key,
            )
        return ChatAnthropic(
            model=m,
            temperature=0.2,
            api_key=settings.anthropic_api_key,
        )
    if not settings.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY is required for synthesis.")
    if m.startswith("gpt-") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return ChatOpenAI(
            model=m,
            temperature=0.2,
            api_key=settings.openai_api_key,
        )
    return ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.2,
        api_key=settings.openai_api_key,
    )


def _rows_to_client_payload(
    sql: str,
    rows: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    rows = rows or []
    value = 0.0
    label = "Result"
    fmt: str = "number"
    for row in rows[:1] or []:
        for k, v in row.items():
            if isinstance(v, (int, float, Decimal)) and v is not None and k != "id":
                value = float(v)
                label = str(k)
                if "margin" in k.lower() or "pct" in k.lower() or "rate" in k.lower():
                    fmt = "percent" if (isinstance(v, float) and -2 <= v <= 2) else "percent"
                elif "revenue" in k.lower() or "notional" in k.lower() or "price" in k.lower():
                    fmt = "currency"
                break
    chart: list[dict[str, str | float]] = []
    if len(rows) > 1:
        for i, r in enumerate(rows[:24]):
            nums = [v for v in r.values() if isinstance(v, (int, float, Decimal))]
            if len(nums) == 1:
                chart.append({"t": f"r{i}", "v": float(nums[0])})
            elif r:
                k0, v0 = next(iter(r.items()))
                if isinstance(v0, (int, float, Decimal)):
                    chart.append({"t": str(k0)[:8], "v": float(v0)})

    if fmt == "percent" and value != 0.0 and abs(value) > 1.0:
        fmt = "number"

    return {  # SqlStreamPayload shape (rows/chart are JSON-serialized via _json_default)
        "value": value,
        "label": label,
        "format": fmt,
        "sql": sql,
        "rows": [_jsonable_row(dict(r)) for r in rows],
        "chart": chart,
    }


def _rag_chunk_summaries(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in chunks[:_max_rag]:
        src = str(c.get("source", ""))
        body = str(c.get("content", ""))[:500]
        out.append(
            {
                "id": str(c.get("id", "")) or None,
                "source": src,
                "content_preview": body.replace("\n", " "),
            }
        )
    return out


async def _stream_events(
    request: Request, body: InsightStreamBody
) -> AsyncIterator[str]:
    ident = await get_identity(request)
    uq = body.query.strip()
    if not uq:
        yield f"data: {_dumps({'type': 'error', 'message': 'empty query'})}\n\n"
        return

    session_id: uuid.UUID | None = None
    try:
        stored_template = f"{INSIGHT_DEMO_PROMPT_ID}\n{INSIGHT_DEMO_PROMPT_DESCRIPTION}"
        session_id = await audit_service.create_session(
            user_id=ident.sub,
            user_role=ident.role,
            prompt_template=stored_template,
            user_query=uq,
        )
        models = default_model_versions()
    except Exception as e:
        yield f"data: {_dumps({'type': 'error', 'message': f'Audit session: {e!s}'})}\n\n"
        return

    audit = str(session_id) if session_id else ""

    g = _get_sql_graph()
    st = await g.ainvoke(
        {
            "user_query": uq,
            "retry_count": 0,
            "generated_sql": None,
            "error_message": None,
        }
    )
    err = (st.get("error_message") or "").strip() if isinstance(st, dict) else None
    sql = (st.get("generated_sql") or "").strip() if isinstance(st, dict) else None
    row_data = st.get("sql_rows") if isinstance(st, dict) else None
    if err or not sql:
        msg = err or (st.get("validation_feedback") or "SQL pipeline produced no read-only query.")
        yield f"data: {_dumps({'type': 'error', 'message': str(msg)[:1_200]})}\n\n"
        return
    try:
        assert_sql_rbac(sql, ident.role)
    except HTTPException as e:  # noqa: BLE001
        d = e.detail
        if not isinstance(d, str):
            d = str(d)
        yield f"data: {_dumps({'type': 'error', 'message': d[:1_200]})}\n\n"
        return

    sql_event = _rows_to_client_payload(sql, row_data)
    # Merge transparency with SQL line
    yield f"data: {_dumps({'type': 'sql', 'data': sql_event})}\n\n"

    emb: list[float] | None = None
    chunks: list[dict[str, Any]] = []
    if (
        settings.openai_api_key
        and settings.supabase_url
        and settings.supabase_service_key
    ):
        try:
            oemb = OpenAIEmbeddings(
                model=settings.embedding_model, api_key=settings.openai_api_key
            )
            emb = await oemb.aembed_query(uq)
            ret = SupabaseRagRetriever(
                config=SupabaseRagConfig(
                    supabase_url=settings.supabase_url,
                    supabase_key=settings.supabase_service_key,
                )
            )
            chunks = await ret.retrieve(emb, match_count=_max_rag)
        except Exception:  # noqa: BLE001
            chunks = []

    src = build_hybrid_sources(sql_query=sql, retrieved=chunks)
    guard = ContextRedactionPiiGuard() if settings.pii_redaction_enabled else None
    if session_id is not None:
        tr2 = {
            "auditId": audit,
            "promptTemplate": stored_template,
            "modelVersions": models,
            "ragChunks": _rag_chunk_summaries(chunks),
            "sql": sql,
        }
        yield f"data: {_dumps({'type': 'transparency', 'data': tr2})}\n\n"

    if settings.pii_redaction_enabled:
        async with redaction_session():
            res = await run_hybrid_synthesis(
                user_query=uq,
                generated_sql=sql,
                sql_result_rows=row_data,
                retrieved_chunks=chunks,
                synthesis_llm=_synthesis_llm(),
                pii_guard=guard,
            )
    else:
        res = await run_hybrid_synthesis(
            user_query=uq,
            generated_sql=sql,
            sql_result_rows=row_data,
            retrieved_chunks=chunks,
            synthesis_llm=_synthesis_llm(),
            pii_guard=None,
        )

    narrative = res.answer
    parts = narrative.split(" ")
    for i, w in enumerate(parts):
        delta = w + (" " if i < len(parts) - 1 else "")
        if delta:
            yield f"data: {_dumps({'type': 'narrative', 'delta': delta})}\n\n"

    if session_id is not None:
        rag_payload = [d.model_dump() for d in src.documents] if src.documents else []
        await audit_service.complete_session(
            session_id,
            final_narrative=narrative,
            generated_sql=sql,
            rag_chunks=rag_payload,
            model_versions=models,
        )
        yield f"data: {_dumps({'type': 'done', 'auditId': audit})}\n\n"
    else:
        yield f"data: {_dumps({'type': 'done', 'auditId': ''})}\n\n"


@router.post("/stream")
async def insight_stream(request: Request, body: InsightStreamBody) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(request, body),
        media_type="text/event-stream; charset=utf-8",
    )
