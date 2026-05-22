"""DELETE /v1/portfolio/.../positions/... returns explicit 204 Response."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.identity import Identity
from app.routers.portfolio import _get_session, router


@pytest.fixture
def portfolio_id() -> str:
    return str(uuid4())


@pytest.fixture
def position_id() -> str:
    return str(uuid4())


@pytest.fixture
def user_id() -> str:
    return str(uuid4())


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _mock_session():
        yield AsyncMock()

    app.dependency_overrides[_get_session] = _mock_session
    return TestClient(app)


def test_delete_position_returns_204(
    client: TestClient,
    portfolio_id: str,
    position_id: str,
    user_id: str,
) -> None:
    ident = Identity(sub=user_id, role="analyst")
    portfolio = object()

    with (
        patch("app.routers.portfolio.get_identity", new_callable=AsyncMock, return_value=ident),
        patch(
            "app.routers.portfolio.portfolio_svc.get_portfolio",
            new_callable=AsyncMock,
            return_value=portfolio,
        ),
        patch(
            "app.routers.portfolio.portfolio_svc.delete_position",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        res = client.delete(f"/v1/portfolio/{portfolio_id}/positions/{position_id}")

    assert res.status_code == 204
    assert res.content == b""


def test_delete_position_404_when_portfolio_missing(
    client: TestClient,
    portfolio_id: str,
    position_id: str,
    user_id: str,
) -> None:
    ident = Identity(sub=user_id, role="analyst")

    with (
        patch("app.routers.portfolio.get_identity", new_callable=AsyncMock, return_value=ident),
        patch(
            "app.routers.portfolio.portfolio_svc.get_portfolio",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        res = client.delete(f"/v1/portfolio/{portfolio_id}/positions/{position_id}")

    assert res.status_code == 404
    assert res.json()["detail"] == "Portfolio not found"


def test_delete_position_404_when_position_missing(
    client: TestClient,
    portfolio_id: str,
    position_id: str,
    user_id: str,
) -> None:
    ident = Identity(sub=user_id, role="analyst")
    portfolio = object()

    with (
        patch("app.routers.portfolio.get_identity", new_callable=AsyncMock, return_value=ident),
        patch(
            "app.routers.portfolio.portfolio_svc.get_portfolio",
            new_callable=AsyncMock,
            return_value=portfolio,
        ),
        patch(
            "app.routers.portfolio.portfolio_svc.delete_position",
            new_callable=AsyncMock,
            return_value=False,
        ),
    ):
        res = client.delete(f"/v1/portfolio/{portfolio_id}/positions/{position_id}")

    assert res.status_code == 404
    assert res.json()["detail"] == "Position not found"
