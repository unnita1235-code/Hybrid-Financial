"""Portfolio graph accessor (lazy-wired to ai-core)."""

from __future__ import annotations


def get_portfolio_graph():
    from aequitas_ai.agents.portfolio_agent import build_portfolio_agent, PortfolioAgentConfig
    from langchain_openai import ChatOpenAI
    from app.config import settings

    analysis_llm = ChatOpenAI(
        model=settings.synthesis_model,
        temperature=0.0
    )
    config = PortfolioAgentConfig(analysis_llm=analysis_llm)
    return build_portfolio_agent(config)
