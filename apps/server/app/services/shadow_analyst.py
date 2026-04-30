r"""
**Shadow analyst** — scheduled volatility scan + optional deep RAG/notification.

# Step A — Z-score (24h activity vs. baseline)

\[
Z = \frac{x - \mu}{\sigma}
\]

* \(x\): 24h total trade notional (``sum(price * volume)``) on ``transactions``,
  optionally paired with 24h index move in ``market_data`` for a combined signal.
* \(\mu, \sigma\): mean and sample standard deviation of *prior* daily notionals
  (excluding the current 24h window) to avoid look-ahead.

# Steps B–D

* If \(|Z| > 2.5\), run the “deep research” pass (news + internal filings) and
  write an ``ai_insight`` row into ``notifications`` for the dashboard badge.
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

log = logging.getLogger(__name__)

# Same threshold as spec: |Z| > 2.5
Z_SCORE_LIMIT = 2.5
INTERVAL_HOURS = 6

Z_SCORE_SQL = """
WITH
h24 AS (
  SELECT coalesce(SUM(t.price * t.volume), 0)::numeric AS notional_24h
  FROM transactions t
  WHERE t.ts_utc >= now() - interval '24 hours'
),
daily AS (
  SELECT
    date_trunc('day', t.ts_utc) AS d,
    SUM(t.price * t.volume)::numeric AS day_notional
  FROM transactions t
  WHERE t.ts_utc < now() - interval '24 hours'
    AND t.ts_utc >= now() - interval '60 days'
  GROUP BY 1
)
SELECT
  h24.notional_24h::float AS x,
  coalesce(dstat.n_days, 0)::int AS n_days,
  coalesce(dstat.mu, 0::numeric)::float AS mu,
  coalesce(dstat.sigma, 1::numeric)::float AS sigma,
  CASE
    WHEN coalesce(dstat.n_days, 0) < 3 THEN NULL
    ELSE (
      (h24.notional_24h - coalesce(dstat.mu, 0::numeric))
      / nullif(coalesce(dstat.sigma, 1::numeric), 0)
    )::float
  END AS z_trades
FROM h24
CROSS JOIN LATERAL (
  SELECT
    count(*)::int AS n_days,
    avg(day_notional) AS mu,
    coalesce(
      nullif(stddev_samp(day_notional), 0::numeric),
      1::numeric
    ) AS sigma
  FROM daily
) AS dstat
"""

# Z on latest index level in ``market_data`` vs. 30d distribution (x = value).
MKT_Z_SQL = """
SELECT
  v.lastv::float AS last_value,
  s.mu::float AS m_mu,
  s.sd::float AS m_sd,
  CASE
    WHEN coalesce(s.n, 0) < 3 THEN NULL
    ELSE ((v.lastv - s.mu) / nullif(s.sd, 0))::float
  END AS z_mkt
FROM (SELECT m.value AS lastv, m.as_of_utc
      FROM market_data m
      ORDER BY m.as_of_utc DESC
      LIMIT 1) AS v
CROSS JOIN LATERAL (
  SELECT
    count(*)::int AS n,
    avg(m2.value) AS mu,
    coalesce(
      nullif(stddev_samp(m2.value), 0::numeric),
      1::numeric
    ) AS sd
  FROM market_data m2
  WHERE m2.as_of_utc >= now() - interval '30 days'
) AS s
"""


@dataclass
class ZResult:
    x: float | None
    mu: float | None
    sigma: float | None
    n_days: int
    z_trades: float | None
    mkt_z: float | None
    z_used: float | None


def _combine_z(row: dict[str, Any], mkt_z: float | None) -> ZResult:
    x = row.get("x")
    mu = row.get("mu")
    sig = row.get("sigma")
    n_days = int(row.get("n_days") or 0)
    zt = row.get("z_trades")
    if zt is not None and isinstance(zt, float) and math.isnan(zt):
        zt = None
    # Effective Z: use trade Z if available; if |mkt| is large, blend (max |.|)
    candidates: list[float] = []
    if zt is not None:
        candidates.append(float(zt))
    if mkt_z is not None:
        candidates.append(float(mkt_z))
    z_used: float | None
    if not candidates:
        z_used = None
    else:
        z_used = max(candidates, key=abs)
    return ZResult(x, mu, sig, n_days, zt, mkt_z, z_used)


@dataclass
class ShadowAnalystService:
    engine: AsyncEngine
    _scheduler: AsyncIOScheduler = field(default_factory=AsyncIOScheduler, repr=False)
    _started: bool = False
    _news_url: str = ""
    _news_key: str | None = None

    def __post_init__(self) -> None:
        self._news_key = settings.news_api_key
        self._news_url = settings.news_api_url

    @classmethod
    def from_url(cls, database_url: str | None = None) -> ShadowAnalystService:
        url = database_url or settings.database_url
        return cls(engine=create_async_engine(url, pool_pre_ping=True, echo=False))

    def start(self) -> None:
        if self._started:
            return
        if not settings.shadow_analyst_enabled:
            log.info("Shadow analyst is disabled (SHADOW_ANALYST_ENABLED=0).")
            return
        self._scheduler.add_job(
            self._run_cycle,
            IntervalTrigger(hours=INTERVAL_HOURS, jitter=30),
            id="shadow_analyst_cycle",
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.start()
        self._started = True
        log.info("Shadow analyst scheduler started: every %s h", INTERVAL_HOURS)

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        self._started = False
        log.info("Shadow analyst scheduler stopped")

    async def _fetch_z(self) -> ZResult | None:
        mkt_z: float | None = None
        async with self.engine.connect() as conn:
            r = await conn.execute(text(Z_SCORE_SQL))
            m = r.mappings().first()
            if not m:
                return None
            try:
                mkr = await conn.execute(text(MKT_Z_SQL))
                mrow = mkr.mappings().first()
            except Exception as e:  # noqa: BLE001
                log.debug("market_data Z skipped: %s", e)
            else:
                if mrow and mrow.get("z_mkt") is not None:
                    mkt_z = float(mrow["z_mkt"])
        return _combine_z(dict(m), mkt_z)

    async def _rag_catalysts(self) -> list[dict[str, Any]]:
        """Search internal `document_embeddings` (filings + transcripts) for catalyst language."""
        q = text(
            """
            SELECT id, source, left(content, 2000) AS content, chunk_metadata
            FROM document_embeddings
            WHERE
              to_tsvector('english', coalesce(content, '')) @@
                plainto_tsquery('english', 'volatility headwind supply chain margin guidance')
            LIMIT 5
            """
        )
        try:
            async with self.engine.connect() as c:
                res = await c.execute(q)
                rows = res.mappings().all()
        except Exception as e:  # noqa: BLE001
            log.warning("RAG (filings) search failed: %s", e)
            return []
        return [dict(r) for r in rows]

    async def _fetch_news_catalysts(self) -> list[dict[str, str]]:
        if not self._news_key:
            return []
        params = {
            "q": "stocks OR earnings OR market volatility",
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 5,
            "apiKey": self._news_key,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.get(self._news_url, params=params)
                r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.warning("News API call failed: %s", e)
            return []
        data = r.json()
        out: list[dict[str, str]] = []
        for a in (data or {}).get("articles") or []:
            out.append(
                {
                    "title": str(a.get("title") or "")[:200],
                    "source": str((a.get("source") or {}).get("name") or ""),
                }
            )
        return out

    async def _run_deep_research(
        self,
        zr: ZResult,
    ) -> dict[str, Any]:
        news = await self._fetch_news_catalysts()
        filings = await self._rag_catalysts()
        return {
            "z_trades": zr.z_trades,
            "z_mkt": zr.mkt_z,
            "z_score_used": zr.z_used,
            "n_baseline_days": zr.n_days,
            "external_catalysts": {
                "news": news,
                "internal_filings_rag": filings,
            },
        }

    async def _store_notification(
        self,
        title: str,
        body: str,
        z_score: float,
        payload: dict[str, Any],
        user_id: UUID | None = None,
    ) -> None:
        now = datetime.now(UTC)
        pstr = json.dumps(payload)
        ins = text(
            """
            INSERT INTO notifications
              (id, user_id, kind, title, body, z_score, payload, read_at, created_at)
            VALUES
              (
                :id,
                :user_id,
                'ai_insight',
                :title,
                :body,
                :z_score,
                CAST(:payloadjson AS jsonb),
                NULL,
                :created_at
              )
            """
        )
        async with self.engine.begin() as conn:
            await conn.execute(
                ins,
                {
                    "id": str(uuid4()),
                    "user_id": user_id,
                    "title": title,
                    "body": body,
                    "z_score": z_score,
                    "payloadjson": pstr,
                    "created_at": now,
                },
            )
        log.info("Stored AI insight notification (Z=%.3f).", z_score)

    async def _run_cycle(self) -> None:
        log.info("Shadow analyst: cycle start")
        zr: ZResult | None
        try:
            zr = await self._fetch_z()
        except Exception as e:  # noqa: BLE001
            log.exception("Z-score query failed: %s", e)
            return
        if zr is None or zr.z_used is None:
            log.info("Z-score: insufficient data, skipping")
            return
        z = zr.z_used
        if abs(z) <= Z_SCORE_LIMIT:
            log.info("Z within band (|Z|=%.3f), no deep research", abs(z))
            return

        try:
            research = await self._run_deep_research(zr)
        except Exception as e:  # noqa: BLE001
            log.exception("Deep research failed: %s", e)
            return

        body_lines = [
            f"24h notional (x) vs. daily baseline: Z_trades = {zr.z_trades!s}, "
            f"Z_market (index) = {zr.mkt_z!s}.",
            "External catalysts (news) and internal filings (RAG) are in the JSON payload for review.",
        ]
        title = "AI Insight: atypical 24h activity (|Z| > 2.5)"
        await self._store_notification(
            title=title,
            body="\n\n".join(body_lines),
            z_score=float(z),
            payload=research,
        )
        log.info("Shadow analyst: cycle done (insight enqueued)")

    async def run_once_debug(self) -> None:
        """Single manual run (e.g. admin endpoint)."""
        await self._run_cycle()
