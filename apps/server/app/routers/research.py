from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from aequitas_ai import (
    ResearchAgentConfig,
    build_research_agent,
    to_research_output_ui,
)
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from pydantic import BaseModel, Field

from app.auth import require_role
from app.config import settings

router = APIRouter(prefix="/v1/research", tags=["research"])
RESEARCH_ACCESS = require_role("analyst", "executive", "admin", "superuser")


class ResearchBody(BaseModel):
    query: str = Field(min_length=10, max_length=2000)


def _dumps(obj: Any) -> str:
    return json.dumps(obj)


def _get_sql_graph(request: Request) -> Any:
    graph = getattr(request.app.state, "sql_graph", None)
    if graph is None:
        raise HTTPException(
            status_code=503,
            detail="SQL graph is unavailable. Check OPENAI_API_KEY and startup logs.",
        )
    return graph


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


async def _run_sql(sql_graph: Any, sub_question: str) -> dict[str, Any]:
    st = await sql_graph.ainvoke(
        {
            "user_query": sub_question,
            "retry_count": 0,
            "generated_sql": None,
            "error_message": None,
        }
    )
    if not isinstance(st, dict):
        return {"summary": "SQL execution returned an unexpected payload.", "rows": []}
    err = (st.get("error_message") or "").strip()
    if err:
        return {"summary": f"SQL error: {err[:400]}", "rows": []}
    sql = (st.get("generated_sql") or "").strip()
    rows = st.get("sql_rows") or []
    if not sql:
        return {"summary": "SQL pipeline produced no query.", "rows": rows}
    return {"summary": f"Executed SQL query for: {sub_question}", "rows": rows}


async def _run_rag(sub_question: str) -> list[dict[str, Any]]:
    if not (
        settings.openai_api_key
        and settings.supabase_url
        and settings.supabase_service_key
    ):
        return []
    try:
        emb = OpenAIEmbeddings(
            model=settings.embedding_model,
            api_key=settings.openai_api_key,
        )
        vec = await emb.aembed_query(sub_question)
        from aequitas_ai import SupabaseRagConfig, SupabaseRagRetriever

        retriever = SupabaseRagRetriever(
            config=SupabaseRagConfig(
                supabase_url=settings.supabase_url,
                supabase_key=settings.supabase_service_key,
            )
        )
        chunks = await retriever.retrieve(vec, match_count=8)
        return chunks if isinstance(chunks, list) else []
    except Exception:
        return []


async def _stream_events(request: Request, body: ResearchBody) -> AsyncIterator[str]:
    user_query = body.query.strip()
    if not user_query:
        yield f"data: {_dumps({'type': 'error', 'message': 'empty query'})}\n\n"
        return

    yield f"data: {_dumps({'type': 'status', 'message': 'Planning research questions...'})}\n\n"

    sql_graph = _get_sql_graph(request)
    llm = _synthesis_llm()
    config = ResearchAgentConfig(
        plan_llm=llm,
        synthesize_llm=llm,
        run_sql=lambda q: _run_sql(sql_graph, q),
        run_rag=_run_rag,
    )
    graph = build_research_agent(config)

    try:
        final_state = await asyncio.wait_for(
            graph.ainvoke({"user_query": user_query}),
            timeout=180.0,
        )
    except TimeoutError:
        yield (
            "data: "
            + _dumps(
                {
                    "type": "error",
                    "message": "Research pipeline timed out after 180s.",
                }
            )
            + "\n\n"
        )
        return
    except Exception as e:
        yield f"data: {_dumps({'type': 'error', 'message': f'Research failed: {e!s}'})}\n\n"
        return

    ui = to_research_output_ui(final_state if isinstance(final_state, dict) else {})

    for i, question in enumerate(ui.sub_questions, start=1):
        yield f"data: {_dumps({'type': 'sub_question', 'index': i, 'question': question})}\n\n"

    for i, per_sub in enumerate(ui.per_sub, start=1):
        sql_summary = str(per_sub.get("sql_summary") or "")
        rag_hits = len(per_sub.get("rag_excerpts") or [])
        payload = {
            "type": "sub_result",
            "index": i,
            "sql_summary": sql_summary,
            "rag_hits": rag_hits,
        }
        yield f"data: {_dumps(payload)}\n\n"

    if ui.discrepancy_warning:
        yield f"data: {_dumps({'type': 'discrepancy_warning'})}\n\n"

    yield f"data: {_dumps({'type': 'summary', 'text': ui.executive_summary})}\n\n"
    yield f"data: {_dumps({'type': 'confidence', 'score': ui.confidence_score})}\n\n"
    yield f"data: {_dumps({'type': 'done'})}\n\n"


@router.post("/stream", dependencies=[RESEARCH_ACCESS])
async def research_stream(
    request: Request,
    body: ResearchBody,
) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(request, body),
        media_type="text/event-stream; charset=utf-8",
    )
