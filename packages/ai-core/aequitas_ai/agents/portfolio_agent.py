"""Portfolio agent scaffold for position-level analysis."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class PortfolioAgent:
    async def ainvoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        positions = payload.get("positions") if isinstance(payload.get("positions"), list) else []
        market_value = sum(float(p.get("market_value", 0)) for p in positions if isinstance(p, dict))
        cost_basis = sum(float(p.get("cost_basis", 0)) for p in positions if isinstance(p, dict))
        return {
            "positions": len(positions),
            "market_value": market_value,
            "cost_basis": cost_basis,
            "unrealized_pnl": market_value - cost_basis,
        }


def build_portfolio_agent() -> PortfolioAgent:
    return PortfolioAgent()
