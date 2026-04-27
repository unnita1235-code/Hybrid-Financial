from __future__ import annotations

import asyncio
import json
from typing import Any

from aequitas_ai import (
    SupabaseRagConfig,
    SupabaseRagRetriever,
)
from fastapi import APIRouter, HTTPException, Request
from langchain_openai import OpenAIEmbeddings
from openai import OpenAI
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter(prefix="/v1/debate", tags=["debate"])

_max_rag_chunks = 8
_max_chunk_chars = 500
_max_sql_rows = 20
_debater_openai_model = "gpt-4o-mini"

_bull_system = """You are The Bull in a financial risk-assessment debate.
Your objective is to build the strongest justified optimistic case for the metric.
Use only provided evidence. Prefer:
- optimistic RAG excerpts,
- favorable historical SQL patterns,
- resilience signals.
Do not fabricate facts. Quote or reference concrete evidence snippets."""

_bear_system = """You are The Bear in a financial risk-assessment debate.
Your objective is to stress downside risk and fragility in the metric.
Use only provided evidence. Prioritize:
- macro headwinds,
- competitor risks and SEC-style red flags in filing language,
- negative SQL trends and asymmetries.
Do not fabricate facts. Be specific and evidence grounded."""

_judge_system = """You are The Judge for a two-sided risk debate.
Return JSON only with keys:
- synthesis (string): concise verdict
- e_bull (number in [0,1]): evidence strength for Bull
- e_bear (number in [0,1]): evidence strength for Bear
- w1 (number in (0,1], optional): Bull weight if you infer one
- w2 (number in (0,1], optional): Bear weight if you infer one
Score should reflect evidence quality and breadth, not rhetoric."""


class DebateRiskRequest(BaseModel):
    metric: str = Field(min_length=3, max_length=500)


class RagSource(BaseModel):
    source: str
    snippet: str


class DebateRiskResponse(BaseModel):
    metric: str
    conviction: float
    e_bull: float
    e_bear: float
    w1: float
    w2: float
    judge_synthesis: str
    bull_argument: str
    bear_argument: str
    sql: str | None = None
    sql_rows_preview: list[dict[str, Any]] = Field(default_factory=list)
    rag_sources: list[RagSource] = Field(default_factory=list)
    used_rag: bool
    used_sql: bool
    warning: str | None = None


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _clamp_conviction(v: float) -> float:
    return max(-1.0, min(1.0, v))


def _to_text_blocks(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            else:
                parts.append(str(item))
        return "\n".join(p for p in parts if p).strip()
    return str(value).strip()


def _format_rag(raw_chunks: list[dict[str, Any]]) -> list[RagSource]:
    out: list[RagSource] = []
    for ch in raw_chunks[:_max_rag_chunks]:
        source = str(ch.get("source") or "unknown")
        content = str(ch.get("content") or "").strip()
        if not content:
            continue
        out.append(RagSource(source=source, snippet=content[:_max_chunk_chars]))
    return out


async def _retrieve_rag(metric: str) -> tuple[list[RagSource], bool, str | None]:
    if not settings.supabase_url or not settings.supabase_service_key:
        return [], False, "RAG disabled: SUPABASE_URL or SUPABASE_SERVICE_KEY missing."
    emb = OpenAIEmbeddings(
        model=settings.embedding_model,
        api_key=settings.openai_api_key,
    )
    query_embedding = await emb.aembed_query(metric)
    retriever = SupabaseRagRetriever(
        config=SupabaseRagConfig(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_key,
        )
    )
    raw = await retriever.retrieve(query_embedding, match_count=_max_rag_chunks)
    sources = _format_rag(raw)
    return sources, bool(sources), None


async def _run_sql_context(
    metric: str, graph: Any
) -> tuple[str | None, list[dict[str, Any]], bool, str | None]:
    sql_query = (
        "Read-only risk assessment support query. "
        "Generate one SQL SELECT/CTE using available schema to surface historical trends, "
        f"directionality, and risk-relevant signals for metric: {metric!r}."
    )
    try:
        out = await graph.ainvoke(
            {
                "user_query": sql_query,
                "retry_count": 0,
                "generated_sql": None,
                "error_message": None,
            }
        )
    except Exception as e:  # noqa: BLE001
        return None, [], False, f"SQL context unavailable: {e!s}"

    sql = out.get("generated_sql")
    rows = out.get("sql_rows") or []
    used_sql = isinstance(sql, str) and bool(sql.strip()) and isinstance(rows, list)
    if not used_sql:
        err = out.get("error_message") or out.get("validation_feedback")
        return None, [], False, f"SQL context unavailable: {err or 'generation failed'}"
    return sql, rows[:_max_sql_rows], True, None


async def _run_debater_openai(client: OpenAI, system: str, user_text: str) -> str:
    def _invoke() -> Any:
        return client.chat.completions.create(
            model=_debater_openai_model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
        )

    msg = await asyncio.to_thread(_invoke)
    return _to_text_blocks(msg.choices[0].message.content or "")


@router.post("/risk-assessment", response_model=DebateRiskResponse)
async def post_risk_assessment(
    request: Request, body: DebateRiskRequest
) -> DebateRiskResponse:
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is required.")
    graph = getattr(request.app.state, "sql_graph", None)
    if graph is None:
        raise HTTPException(
            status_code=503,
            detail="SQL graph is unavailable. Check OPENAI_API_KEY and startup logs.",
        )

    sql, sql_rows, used_sql, sql_warning = await _run_sql_context(body.metric, graph)
    rag_sources, used_rag, rag_warning = await _retrieve_rag(body.metric)

    rag_blob = "\n".join(
        f"- [{src.source}] {src.snippet}"
        for src in rag_sources
    ) or "(no retrieved RAG evidence)"
    sql_blob = json.dumps(sql_rows, ensure_ascii=True, indent=2) if sql_rows else "[]"
    context = (
        f"Metric request: {body.metric}\n\n"
        f"RAG evidence snippets:\n{rag_blob}\n\n"
        f"SQL statement:\n{sql or '(none)'}\n\n"
        f"SQL rows preview:\n{sql_blob}\n"
    )

    debater_client = OpenAI(api_key=settings.openai_api_key)
    bull_task = _run_debater_openai(
        debater_client,
        _bull_system,
        context,
    )
    bear_task = _run_debater_openai(
        debater_client,
        _bear_system,
        context,
    )
    bull_argument, bear_argument = await asyncio.gather(bull_task, bear_task)

    judge_client = OpenAI(api_key=settings.openai_api_key)
    judge_user = (
        f"Metric: {body.metric}\n\n"
        f"Bull argument:\n{bull_argument}\n\n"
        f"Bear argument:\n{bear_argument}\n\n"
        "Return JSON only."
    )
    def _judge_invoke() -> Any:
        return judge_client.chat.completions.create(
            model=settings.sql_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _judge_system},
                {"role": "user", "content": judge_user},
            ],
        )

    judge_res = await asyncio.to_thread(_judge_invoke)
    raw = _to_text_blocks(judge_res.choices[0].message.content or "{}")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}

    e_bull = _clamp01(float(payload.get("e_bull", 0.5)))
    e_bear = _clamp01(float(payload.get("e_bear", 0.5)))
    w1 = _clamp01(float(payload.get("w1", settings.debate_w1))) or settings.debate_w1
    w2 = _clamp01(float(payload.get("w2", settings.debate_w2))) or settings.debate_w2
    c_final = _clamp_conviction((w1 * e_bull) - (w2 * e_bear))
    synthesis = str(payload.get("synthesis") or "Judge synthesis unavailable.")

    warnings = [w for w in [sql_warning, rag_warning] if w]
    return DebateRiskResponse(
        metric=body.metric,
        conviction=c_final,
        e_bull=e_bull,
        e_bear=e_bear,
        w1=w1,
        w2=w2,
        judge_synthesis=synthesis,
        bull_argument=bull_argument or "(Bull produced no output.)",
        bear_argument=bear_argument or "(Bear produced no output.)",
        sql=sql,
        sql_rows_preview=sql_rows,
        rag_sources=rag_sources,
        used_rag=used_rag,
        used_sql=used_sql,
        warning=" | ".join(warnings) if warnings else None,
    )
