r"""What-if **scenario simulation** (rolled-back transaction) API."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth.identity import get_identity
from app.services.simulator import ScenarioSimulationResult, run_scenario_simulation

router = APIRouter(prefix="/v1/simulation", tags=["simulation"])


class ScenarioRequest(BaseModel):
    what_if: str = Field(
        description="Natural-language hypothetical (e.g. 'material costs +15%')",
    )
    insight_query: str = Field(
        description="Same NL as the dashboard SQL agent uses for the read query.",
    )


@router.post("/scenario", response_model=ScenarioSimulationResult)
async def post_scenario(request: Request, body: ScenarioRequest) -> ScenarioSimulationResult:
    ident = await get_identity(request)
    return await run_scenario_simulation(
        what_if=body.what_if,
        insight_query=body.insight_query,
        user_role=ident.role,
    )
