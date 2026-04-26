"""Smoke test for the hybrid memo API (reports router) without the full `app.main` import graph."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.reports import router as reports_router


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(reports_router)
    return TestClient(app)


def test_memo_rejects_inverted_range(client: TestClient) -> None:
    r = client.post(
        "/v1/reports/memo",
        json={
            "start_date": "2026-12-01",
            "end_date": "2026-01-01",
            "metric_focus": "Q3 Revenue Leakage",
        },
    )
    assert r.status_code == 400
    assert "date" in r.json()["detail"].lower()


def test_memo_ok_structure(client: TestClient) -> None:
    r = client.post(
        "/v1/reports/memo",
        json={
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "metric_focus": "Q3 Revenue Leakage",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for key in (
        "final_memo",
        "draft",
        "sql_context",
        "sql_summary",
        "counter_arguments",
        "risk_factors",
        "news_headlines",
        "used_llm",
        "used_news_api",
    ):
        assert key in data, f"missing {key}"
    assert isinstance(data["final_memo"], str) and len(data["final_memo"]) > 50
    assert isinstance(data["counter_arguments"], list)
    assert isinstance(data["risk_factors"], list)
