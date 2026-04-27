"""Alert triage graph accessor (lazy-wired to ai-core)."""

from __future__ import annotations


def get_alert_triage_graph():
    from aequitas_ai.agents.alert_agent import build_alert_agent

    return build_alert_agent()
