"""Research graph accessor (lazy-wired to ai-core)."""

from __future__ import annotations


def get_research_graph():
    from aequitas_ai.agents.research_agent import build_research_agent

    return build_research_agent()
