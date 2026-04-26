r"""Hybrid memo: SQL-sourced context + RAG-style narrative draft, then critic with live news.

Falls back to a deterministic sample when `OPENAI_API_KEY` is unset.
"""

from __future__ import annotations

import json
import os
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter(prefix="/v1/reports", tags=["reports"])


class MemoRequest(BaseModel):
    start_date: str = Field(description="ISO date YYYY-MM-DD")
    end_date: str = Field(description="ISO date YYYY-MM-DD")
    metric_focus: str = Field(
        default="Q3 Revenue Leakage",
        min_length=1,
        max_length=400,
    )


class MemoResponse(BaseModel):
    metric_focus: str
    start_date: str
    end_date: str
    sql_context: str
    sql_summary: str
    rag_narrative_hint: str
    draft: str
    news_headlines: list[str] = Field(default_factory=list)
    counter_arguments: list[str] = Field(default_factory=list)
    risk_factors: list[str] = Field(default_factory=list)
    final_memo: str
    model_synthesis: str
    used_llm: bool
    used_news_api: bool


def _hybrid_sql_stub(start: str, end: str, metric: str) -> tuple[str, str]:
    """Read-only style SQL and one-line human summary (stub when DB not queried)."""
    sql = f"""-- Read-only: transactions in window [{start}, {end}] for {metric!r} analysis
SELECT
  coalesce(SUM(t.price * t.volume), 0) AS notional,
  count(*)::bigint AS n_trades
FROM transactions t
WHERE t.ts_utc >= :start_utc
  AND t.ts_utc <  :end_utc;"""
    summary = (
        f"Notional in window aggregated for '{metric}'; compare vs prior period off-line if needed. "
        f"Period: {start} to {end}."
    )
    return sql, summary


async def _fetch_news(keywords: str) -> list[str]:
    if not settings.news_api_key:
        return [
            "Markets: volatility in rates linked to flow shifts (RAG: external wire stub)",
            "Credit: issuer spreads watched into quarter-end (RAG: external wire stub)",
        ]
    params = {
        "q": keywords or "earnings revenue guidance",
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 5,
        "apiKey": settings.news_api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(settings.news_api_url, params=params)
            r.raise_for_status()
    except (httpx.HTTPError, OSError) as e:  # noqa: BLE001
        return [f"News API unavailable: {e}"]
    data = r.json() or {}
    out: list[str] = []
    for a in (data.get("articles") or [])[:5]:
        t = (a or {}).get("title") or ""
        s = (a or {}).get("source") or {}
        name = s.get("name", "") if isinstance(s, dict) else ""
        if t:
            out.append(f"{t} — {name}".strip(" —")[:200])
    return out or ["No recent headlines returned."]


def _fallback_memo(
    start: str,
    end: str,
    metric: str,
    sql: str,
    sql_summary: str,
    news: list[str],
) -> tuple[str, list[str], list[str], str]:
    draft = (
        f"### Executive context\n"
        f"**Focus:** {metric}\n**Window:** {start} through {end}.\n\n"
        f"### Hybrid signal\n"
        f"SQL anchor: {sql_summary} "
        f"The draft couples this read with internal document tone (RAG) where filings "
        f"or transcripts reference revenue quality, price/mix, or one-off items that could present "
        f"as 'leakage' versus run-rate revenue.\n\n"
        f"### Narrative (target ~500 words — truncated in offline mode)\n"
        f"We interpret the notional and trade density in the range as a liquidity proxy for "
        f"revenue-impacted names in scope. When guidance or segment disclosure is soft, the "
        f"**apparent** leakage may overstate the economic impact if the window captures rebalance or "
        f"restatement noise. The conservative posture is to stress-test the margin bridge against "
        f"cash collection and DSO, not the headline TTM read alone. Where RAG context surfaces "
        f"management verbiage on 'mix' and 'incentives', weight those before attributing a single "
        f"revenue line item as structural loss.\n"
    )
    counters = [
        "Macro prints this week can invert sector beta—short window SQL may be dominated by idiosyncratic block trades.",
        "If Q3 was seasonally light historically, a YoY read without a seasonality model overstates 'leakage'.",
    ]
    risks = [
        "Filing and transcript retrieval may be stale for intraday; verify against latest 8-K events.",
        "Revenue 'leakage' as a label may conflate one-offs with true run-rate degradation.",
    ]
    news_block = "\n".join(f"- {h}" for h in news)
    final = (
        f"{draft}\n\n---\n## Counter-arguments (Critic / news-aware)\n"
        + "\n".join(f"- {c}" for c in counters)
        + "\n\n## Risk factors\n"
        + "\n".join(f"- {r}" for r in risks)
        + f"\n\n## Market wire (RAG / News)\n{news_block}\n\n## SQL (read path)\n```sql\n{sql}\n```\n"
    )
    return draft, counters, risks, final


async def _llm_draft(
    start: str,
    end: str,
    metric: str,
    sql: str,
    sql_summary: str,
    news: list[str],
) -> tuple[str, list[str], list[str], str, bool]:
    key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    if not key:
        d, c, r, f = _fallback_memo(start, end, metric, sql, sql_summary, news)
        return d, c, r, f, False

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=key)
    news_blob = "\n".join(f"- {h}" for h in news) if news else "(none)"

    dr = await client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.4,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a buy-side / FP&A analyst. Write a professional memo, "
                    "about 500 words, markdown headings allowed. Incorporate a hybrid "
                    "stance: a read-only SQL summary of trade notionals in the date window "
                    "plus an internal RAG angle (implied) about filings/transcripts. "
                    "Cite the SQL in spirit but do not fabricate specific dollar figures not implied."
                ),
            },
            {
                "role": "user",
                "content": f"""Date range: {start} to {end}
Metric focus: {metric}
SQL (read path):
{sql}
SQL summary: {sql_summary}
Recent news headlines (context):
{news_blob}
Write the memo (≈500 words).""",
            },
        ],
    )
    draft = (dr.choices[0].message.content or "").strip()

    cr = await client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Critic / risk agent. Given the draft memo and latest headlines, "
                    "output JSON with keys: counter_arguments (array of 3-5 short strings), "
                    "risk_factors (array of 3-5 short strings). Be concrete, skeptical, not repetitive."
                ),
            },
            {
                "role": "user",
                "content": f"""Draft:
{draft}

Headlines:
{news_blob}""",
            },
        ],
    )
    raw = (cr.choices[0].message.content or "{}").strip()
    try:
        j = json.loads(raw)
    except json.JSONDecodeError:
        j = {"counter_arguments": [], "risk_factors": []}
    ca = j.get("counter_arguments") or []
    rf = j.get("risk_factors") or []
    if not isinstance(ca, list):
        ca = []
    if not isinstance(rf, list):
        rf = []
    ca = [str(x) for x in ca if str(x).strip()][:6]
    rf = [str(x) for x in rf if str(x).strip()][:6]

    final = (
        f"{draft}\n\n---\n## Counter-arguments (Critic)\n"
        + "\n".join(f"- {x}" for x in ca)
        + "\n\n## Risk factors (Critic)\n"
        + "\n".join(f"- {x}" for x in rf)
        + f"\n\n## Market wire (for traceability)\n{news_blob}\n\n## SQL (read path)\n```sql\n{sql}\n```\n"
    )
    return draft, ca, rf, final, True


@router.post("/memo", response_model=MemoResponse)
async def post_memo(body: MemoRequest) -> MemoResponse:
    try:
        d0 = date.fromisoformat(body.start_date)
        d1 = date.fromisoformat(body.end_date)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid date: {e}") from e
    if d0 > d1:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")

    sql, sql_sum = _hybrid_sql_stub(
        body.start_date,
        body.end_date,
        body.metric_focus,
    )
    news = await _fetch_news(body.metric_focus)
    used_news = bool(settings.news_api_key)
    try:
        draft, ca, rf, final, used_llm = await _llm_draft(
            body.start_date,
            body.end_date,
            body.metric_focus,
            sql,
            sql_sum,
            news,
        )
    except Exception as e:  # noqa: BLE001
        d, c, r, f = _fallback_memo(
            body.start_date,
            body.end_date,
            body.metric_focus,
            sql,
            sql_sum,
            news,
        )
        return MemoResponse(
            metric_focus=body.metric_focus,
            start_date=body.start_date,
            end_date=body.end_date,
            sql_context=sql,
            sql_summary=sql_sum,
            rag_narrative_hint="Filings + transcripts (vector store) as qualitative overlay",
            draft=d,
            news_headlines=news,
            counter_arguments=c,
            risk_factors=r,
            final_memo=f + f"\n\n_(Critic path degraded: {e!s})_",
            model_synthesis=settings.synthesis_model,
            used_llm=False,
            used_news_api=used_news,
        )

    return MemoResponse(
        metric_focus=body.metric_focus,
        start_date=body.start_date,
        end_date=body.end_date,
        sql_context=sql,
        sql_summary=sql_sum,
        rag_narrative_hint="Earnings/SEC RAG (hybrid) — qualitative catalyst / language layer",
        draft=draft,
        news_headlines=news,
        counter_arguments=ca,
        risk_factors=rf,
        final_memo=final,
        model_synthesis=settings.synthesis_model,
        used_llm=used_llm,
        used_news_api=used_news,
    )
