"""Filing search tests — mocked httpx, no network, no env vars."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx

from aequitas_ai.tools.filing_search import search_filings


EDGAR_VALID_RESPONSE = {
    "hits": {
        "hits": [
            {
                "_source": {
                    "entity_name": "Apple Inc.",
                    "form_type": "10-K",
                    "file_date": "2024-11-01",
                    "accession_no": "0000320193-24-000123",
                    "period_of_report": "2024-09-28",
                }
            },
            {
                "_source": {
                    "entity_name": "Microsoft Corp",
                    "form_type": "10-Q",
                    "file_date": "2024-10-25",
                    "accession_no": "0000789019-24-000456",
                    "period_of_report": "2024-09-30",
                }
            },
        ]
    }
}


def _make_mock_client(response_json=None, raise_error=None):
    """Create a mock httpx.AsyncClient with context manager support."""
    mock_client = AsyncMock()

    if raise_error:
        mock_client.get = AsyncMock(side_effect=raise_error)
    else:
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = response_json or {}
        mock_client.get = AsyncMock(return_value=mock_response)

    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


@pytest.mark.asyncio
async def test_parse_edgar_response():
    mock_client = _make_mock_client(response_json=EDGAR_VALID_RESPONSE)
    with patch("aequitas_ai.tools.filing_search.httpx.AsyncClient", return_value=mock_client):
        results = await search_filings("revenue recognition", limit=2)

    assert len(results) <= 2
    for r in results:
        assert r["edgar_url"].startswith("https://www.sec.gov")
        assert isinstance(r["entity_name"], str)
        assert len(r["entity_name"]) > 0
        assert r["form_type"] in ("10-K", "10-Q")


@pytest.mark.asyncio
async def test_edgar_network_error_returns_empty():
    mock_client = _make_mock_client(raise_error=httpx.ConnectError("Connection refused"))
    with patch("aequitas_ai.tools.filing_search.httpx.AsyncClient", return_value=mock_client):
        results = await search_filings("test")

    assert results == []
