"""Market data tool tests — mocked httpx, no network, no env vars."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx

from aequitas_ai.tools.market_data import fetch_market_price, MarketDataResult


YAHOO_VALID_RESPONSE = {
    "chart": {
        "result": [
            {
                "meta": {
                    "symbol": "AAPL",
                    "regularMarketPrice": 195.42,
                    "currency": "USD",
                }
            }
        ]
    }
}


@pytest.fixture
def _mock_httpx_404():
    """Mock httpx.AsyncClient to return 404."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 404
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Not Found", request=MagicMock(), response=mock_response
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    return mock_client


@pytest.fixture
def _mock_httpx_ok():
    """Mock httpx.AsyncClient to return valid Yahoo JSON."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = YAHOO_VALID_RESPONSE

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    return mock_client


@pytest.mark.asyncio
async def test_unavailable_on_bad_symbol(_mock_httpx_404):
    with patch("aequitas_ai.tools.market_data.httpx.AsyncClient", return_value=_mock_httpx_404):
        result = await fetch_market_price("NOTREAL_XYZ_FAKE")
    assert result["source"] == "unavailable"
    assert result["price"] is None
    assert result["error"] is not None


@pytest.mark.asyncio
async def test_parse_yahoo_response_shape(_mock_httpx_ok):
    with patch("aequitas_ai.tools.market_data.httpx.AsyncClient", return_value=_mock_httpx_ok):
        result = await fetch_market_price("AAPL")
    assert isinstance(result["price"], float)
    assert result["source"] == "yahoo"
    assert result["error"] is None
    assert result["symbol"] == "AAPL"
