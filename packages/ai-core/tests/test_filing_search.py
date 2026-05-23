import pytest
import httpx
from unittest.mock import AsyncMock, patch
from aequitas_ai.tools.filing_search import search_filings

@pytest.mark.asyncio
async def test_parse_edgar_response():
    mock_json = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "entity_name": "Apple Inc.",
                        "form_type": "10-K",
                        "file_date": "2023-11-03",
                        "accession_no": "0000320193-23-000106",
                        "period_of_report": "2023-09-30",
                        "entity_id": "0000320193"
                    }
                },
                {
                    "_source": {
                        "entity_name": "Microsoft Corp",
                        "form_type": "10-Q",
                        "file_date": "2023-10-24",
                        "accession_no": "0000090281-23-000085",
                        "period_of_report": "2023-09-30",
                        "entity_id": "0000090281"
                    }
                },
                {
                    "_source": {
                        "entity_name": "Tesla Inc",
                        "form_type": "10-K",
                        "file_date": "2023-01-31",
                        "accession_no": "0001564590-23-001225",
                        "period_of_report": "2022-12-31",
                        "entity_id": "0001318605"
                    }
                }
            ]
        }
    }

    from unittest.mock import MagicMock
    mock_response = MagicMock()
    mock_response.json.return_value = mock_json
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response

        results = await search_filings("revenue recognition", limit=2)

        assert len(results) <= 2
        assert len(results) == 2  # As mock provides 3 and limit is 2
        
        for r in results:
            assert r["edgar_url"].startswith("https://www.sec.gov")
            assert isinstance(r["entity_name"], str)
            assert len(r["entity_name"]) > 0

@pytest.mark.asyncio
async def test_edgar_network_error_returns_empty():
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.side_effect = httpx.ConnectError("Network Error")

        results = await search_filings("test")
        
        assert results == []
