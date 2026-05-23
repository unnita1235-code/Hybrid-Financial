import pytest
from httpx import Response, Request
from unittest.mock import patch, AsyncMock
from aequitas_ai.tools.market_data import fetch_market_price

@pytest.mark.asyncio
async def test_unavailable_on_bad_symbol():
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        # Mocking a 404 response
        mock_request = Request("GET", "https://mock")
        mock_response = Response(404, request=mock_request)
        mock_get.return_value = mock_response

        result = await fetch_market_price("NOTREAL_XYZ_FAKE")

        assert result["source"] == "unavailable"
        assert result["price"] is None
        assert result["error"] is not None

@pytest.mark.asyncio
async def test_parse_yahoo_response_shape():
    mock_yahoo_data = {
        "chart": {
            "result": [
                {
                    "meta": {
                        "regularMarketPrice": 150.25
                    }
                }
            ]
        }
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        # Mocking a valid 200 JSON response
        mock_request = Request("GET", "https://mock")
        mock_response = Response(200, json=mock_yahoo_data, request=mock_request)
        mock_get.return_value = mock_response

        result = await fetch_market_price("AAPL")

        assert result["source"] == "yahoo"
        assert isinstance(result["price"], float)
        assert result["price"] == 150.25
        assert result["error"] is None
