"""Portfolio agent — LangGraph concentration analysis + LLM risk assessment."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langchain_core.language_models import BaseChatModel
from langgraph.graph import StateGraph, END
from typing_extensions import TypedDict


class PortfolioAgentState(TypedDict):
    portfolio_context: dict
    user_question: str
    analysis: str | None
    concentration_flags: list[str]
    error: str | None


def compute_concentration_flags(positions: list[dict], total_value: float) -> list[str]:
    """Pure math — no LLM, no I/O. Importable for testing."""
    flags: list[str] = []
    if len(positions) < 3:
        flags.append("UNDIVERSIFIED: fewer than 3 positions")
    if total_value <= 0:
        return flags
    for pos in positions:
        qty = float(pos.get("quantity", pos.get("qty", 0)))
        price = float(pos.get("current_price", pos.get("price", 0)))
        weight = (qty * price) / total_value
        if weight > 0.25:
            symbol = pos.get("symbol", pos.get("ticker", "UNKNOWN"))
            flags.append(f"CONCENTRATION: {symbol} at {weight:.1%}")
    return flags


def _compute_concentration_node(state: PortfolioAgentState) -> dict:
    ctx = state["portfolio_context"]
    positions = ctx.get("positions", [])
    total_value = float(ctx.get("total_value", 0))
    flags = compute_concentration_flags(positions, total_value)
    return {"concentration_flags": flags}


def _llm_analysis_node(state: PortfolioAgentState, *, llm: BaseChatModel) -> dict:
    import json
    from langchain_core.messages import HumanMessage, SystemMessage

    system = SystemMessage(content=(
        "You are a portfolio risk analyst for Aequitas FI. "
        "Analyze the provided positions, P&L, and concentration flags. "
        "Be specific: name symbols, cite percentages from the data. "
        "Do not invent prices or returns not in the context."
    ))
    human = HumanMessage(content=json.dumps({
        "portfolio": state["portfolio_context"],
        "concentration_flags": state["concentration_flags"],
        "question": state["user_question"],
    }, default=str))

    try:
        response = llm.invoke([system, human])
        return {"analysis": response.content}
    except Exception as exc:
        return {"error": str(exc)}


@dataclass
class PortfolioAgentConfig:
    analysis_llm: BaseChatModel


def build_portfolio_agent(config: PortfolioAgentConfig | None = None):
    """Build a compiled LangGraph for portfolio analysis.

    If called with no config, raises NotImplementedError to signal
    that the server graph registry must be updated to provide config.
    """
    if config is None:
        raise NotImplementedError(
            "PortfolioAgent requires PortfolioAgentConfig. "
            "Update app/graph/portfolio.py."
        )

    graph = StateGraph(PortfolioAgentState)
    graph.add_node("compute_concentration", _compute_concentration_node)
    graph.add_node(
        "llm_analysis",
        lambda state: _llm_analysis_node(state, llm=config.analysis_llm),
    )
    graph.set_entry_point("compute_concentration")
    graph.add_edge("compute_concentration", "llm_analysis")
    graph.add_edge("llm_analysis", END)
    return graph.compile()


# Backward-compat wrapper
class PortfolioAgent:
    """Thin wrapper kept for import compatibility."""

    def __init__(self, config: PortfolioAgentConfig):
        self._graph = build_portfolio_agent(config)

    async def ainvoke(self, payload: dict) -> dict:
        return await self._graph.ainvoke(payload)
