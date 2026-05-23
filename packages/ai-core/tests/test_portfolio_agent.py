"""Portfolio agent tests — pure math, no LLM, no env vars."""
from aequitas_ai.agents.portfolio_agent import (
    compute_concentration_flags,
    build_portfolio_agent,
)
import pytest


def test_concentration_flags_high_weight():
    positions = [
        {"symbol": "AAPL", "quantity": 80, "current_price": 100},
        {"symbol": "MSFT", "quantity": 20, "current_price": 100},
    ]
    total_value = 10_000.0  # AAPL=8000 (80%), MSFT=2000 (20%)
    flags = compute_concentration_flags(positions, total_value)
    assert any("CONCENTRATION: AAPL at 80.0%" in f for f in flags)
    assert not any("MSFT" in f for f in flags)  # MSFT is 20%, under 25%


def test_undiversified_flag():
    positions = [{"symbol": "TSLA", "quantity": 10, "current_price": 200}]
    total_value = 2000.0
    flags = compute_concentration_flags(positions, total_value)
    assert any("UNDIVERSIFIED" in f for f in flags)


def test_no_flags_for_balanced_portfolio():
    positions = [
        {"symbol": "A", "quantity": 25, "current_price": 100},
        {"symbol": "B", "quantity": 25, "current_price": 100},
        {"symbol": "C", "quantity": 25, "current_price": 100},
        {"symbol": "D", "quantity": 25, "current_price": 100},
    ]
    total_value = 10_000.0
    flags = compute_concentration_flags(positions, total_value)
    assert flags == []


def test_build_portfolio_agent_no_config_raises():
    with pytest.raises(NotImplementedError, match="PortfolioAgentConfig"):
        build_portfolio_agent()
