"""Portfolio graph accessor (lazy-wired to ai-core)."""

from __future__ import annotations


def get_portfolio_graph():
    from aequitas_ai.agents.portfolio_agent import build_portfolio_agent

    return build_portfolio_agent()
