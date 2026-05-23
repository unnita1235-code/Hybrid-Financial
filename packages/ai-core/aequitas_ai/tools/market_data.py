"""Market data tool — DB-first with Yahoo Finance fallback."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from typing_extensions import TypedDict

log = logging.getLogger(__name__)


class MarketDataResult(TypedDict):
    symbol: str
    price: float | None
    source: Literal["db", "yahoo", "unavailable"]
    as_of_utc: str | None
    error: str | None


async def fetch_market_price(
    symbol: str,
    session=None,  # AsyncSession | None — import guarded to avoid hard dep
) -> MarketDataResult:
    """Fetch price: try DB first, then Yahoo Finance, never raise."""
    symbol = symbol.strip().upper()

    # Layer 1 — DB lookup (if session provided)
    if session is not None:
        try:
            from sqlalchemy import text as sa_text

            row = (
                await session.execute(
                    sa_text(
                        "SELECT value, as_of_utc FROM market_data "
                        "WHERE code = :symbol ORDER BY as_of_utc DESC LIMIT 1"
                    ),
                    {"symbol": symbol},
                )
            ).first()
            if row is not None:
                as_of = row[1]
                if isinstance(as_of, datetime) and (
                    datetime.now(timezone.utc) - as_of.replace(tzinfo=timezone.utc)
                ) < timedelta(hours=24):
                    return MarketDataResult(
                        symbol=symbol,
                        price=float(row[0]),
                        source="db",
                        as_of_utc=as_of.isoformat(),
                        error=None,
                    )
        except Exception as exc:
            log.warning("DB lookup failed for %s: %s", symbol, exc)

    # Layer 2 — Yahoo Finance (no API key required)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url, params={"interval": "1d", "range": "1d"}, timeout=10.0
            )
            resp.raise_for_status()
            data = resp.json()
            result_list = data.get("chart", {}).get("result")
            if not result_list:
                return MarketDataResult(
                    symbol=symbol,
                    price=None,
                    source="unavailable",
                    as_of_utc=None,
                    error="No result in Yahoo response",
                )
            price = result_list[0].get("meta", {}).get("regularMarketPrice")
            if price is None:
                return MarketDataResult(
                    symbol=symbol,
                    price=None,
                    source="unavailable",
                    as_of_utc=None,
                    error="regularMarketPrice not found in Yahoo response",
                )
            return MarketDataResult(
                symbol=symbol,
                price=float(price),
                source="yahoo",
                as_of_utc=datetime.now(timezone.utc).isoformat(),
                error=None,
            )
    except Exception as exc:
        log.warning("Yahoo Finance lookup failed for %s: %s", symbol, exc)
        return MarketDataResult(
            symbol=symbol,
            price=None,
            source="unavailable",
            as_of_utc=None,
            error=str(exc),
        )
