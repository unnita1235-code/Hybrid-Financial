import logging
from typing import TypedDict
import httpx

logger = logging.getLogger(__name__)

class FilingResult(TypedDict):
    entity_name: str
    form_type: str
    file_date: str
    accession_no: str
    period_of_report: str | None
    edgar_url: str

async def search_filings(
    query: str,
    form_types: list[str] | None = None,
    limit: int = 5,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[FilingResult]:
    if form_types is None:
        form_types = ["10-K", "10-Q"]
    
    limit = min(limit, 10)
    
    url = "https://efts.sec.gov/LATEST/search-index"
    headers = {
        "User-Agent": "Aequitas-FI research@aequitasfi.example (academic use)"
    }
    
    params = {
        "q": f'"{query}"',
        "forms": ",".join(form_types)
    }
    if start_date or end_date:
        params["dateRange"] = "custom"
        if start_date:
            params["startdt"] = start_date
        if end_date:
            params["enddt"] = end_date
            
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, headers=headers, timeout=15.0)
            response.raise_for_status()
            data = response.json()
            
            hits = data.get("hits", {}).get("hits", [])
            results = []
            
            for hit in hits[:limit]:
                source = hit.get("_source", {})
                
                accession_no = str(source.get("accession_no") or "")
                accession_clean = accession_no.replace("-", "")
                
                cik = str(source.get("entity_id") or "0000000000")
                edgar_url = f"https://www.sec.gov/Archives/edgar/{cik}/{accession_clean}/" if accession_clean else ""
                
                period_of_report = source.get("period_of_report")
                
                result: FilingResult = {
                    "entity_name": str(source.get("entity_name") or ""),
                    "form_type": str(source.get("form_type") or ""),
                    "file_date": str(source.get("file_date") or ""),
                    "accession_no": accession_no,
                    "period_of_report": str(period_of_report) if period_of_report is not None else None,
                    "edgar_url": edgar_url
                }
                results.append(result)
                
            return results
    except Exception as e:
        logger.warning(f"Error fetching SEC filings: {e}")
        return []
