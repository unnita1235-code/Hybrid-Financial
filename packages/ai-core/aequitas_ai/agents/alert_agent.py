"""Alert triage agent scaffold."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class AlertAgent:
    async def ainvoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        z_score = float(payload.get("z_score") or 0.0)
        if z_score >= 4:
            severity = "critical"
        elif z_score >= 3:
            severity = "high"
        elif z_score >= 2:
            severity = "medium"
        else:
            severity = "low"
        return {
            "severity": severity,
            "summary": "Alert triage scaffold generated a provisional severity.",
            "suggested_action": "Review position-level drivers and confirm market catalysts.",
        }


def build_alert_agent() -> AlertAgent:
    return AlertAgent()
