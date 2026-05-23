"""Market data tool node implementation."""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Literal, TypedDict, Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class MarketDataResult(TypedDict):
    symbol: str
    price: float | None
    source: Literal["db", "yahoo", "unavailable"]
    as_of_utc: str | None
    error: str | None


async def fetch_market_price(
    symbol: str,
    session: AsyncSession | None = None,
) -> MarketDataResult:
    symbol = symbol.upper()
    
    # Layer 1 (DB-first)
    if session is not None:
        try:
            stmt = text(
                "SELECT value, as_of_utc FROM market_data "
                "WHERE code = :symbol ORDER BY as_of_utc DESC LIMIT 1"
            )
            result = await session.execute(stmt, {"symbol": symbol})
            row = result.fetchone()
            
            if row:
                value = row.value
                as_of_utc = row.as_of_utc
                # Depending on driver, as_of_utc might be datetime or string
                if isinstance(as_of_utc, str):
                    try:
                        as_of_utc_dt = datetime.fromisoformat(as_of_utc.replace("Z", "+00:00"))
                    except ValueError:
                        as_of_utc_dt = None
                else:
                    as_of_utc_dt = as_of_utc
                
                if as_of_utc_dt is not None:
                    # Ensure timezone awareness
                    if as_of_utc_dt.tzinfo is None:
                        as_of_utc_dt = as_of_utc_dt.replace(tzinfo=timezone.utc)
                    
                    if datetime.now(timezone.utc) - as_of_utc_dt <= timedelta(hours=24):
                        return {
                            "symbol": symbol,
                            "price": float(value),
                            "source": "db",
                            "as_of_utc": as_of_utc_dt.isoformat(),
                            "error": None
                        }
        except Exception as e:
            logger.warning(f"Error querying DB for {symbol}: {e}")
            # Fall through to Layer 2

    # Layer 2 (Yahoo Finance fallback)
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        params = {"interval": "1d", "range": "1d"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            
            result_list = data.get("chart", {}).get("result", [])
            if not result_list:
                return {
                    "symbol": symbol,
                    "price": None,
                    "source": "unavailable",
                    "as_of_utc": None,
                    "error": "No result found in Yahoo Finance response"
                }
                
            regular_market_price = result_list[0].get("meta", {}).get("regularMarketPrice")
            if regular_market_price is None:
                return {
                    "symbol": symbol,
                    "price": None,
                    "source": "unavailable",
                    "as_of_utc": None,
                    "error": "regularMarketPrice not found in Yahoo Finance response"
                }
                
            return {
                "symbol": symbol,
                "price": float(regular_market_price),
                "source": "yahoo",
                "as_of_utc": datetime.now(timezone.utc).isoformat(),
                "error": None
            }
            
    except Exception as e:
        return {
            "symbol": symbol,
            "price": None,
            "source": "unavailable",
            "as_of_utc": None,
            "error": str(e)
        }
