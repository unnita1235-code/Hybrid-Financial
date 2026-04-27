"""Market data tool node scaffold."""

from __future__ import annotations


async def fetch_market_price(symbol: str) -> dict[str, str | float]:
    return {"symbol": symbol.upper(), "price": 0.0, "source": "stub"}
