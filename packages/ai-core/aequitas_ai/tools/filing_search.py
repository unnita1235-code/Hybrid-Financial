"""SEC filing search tool node scaffold."""

from __future__ import annotations


async def search_filings(query: str, limit: int = 5) -> list[dict[str, str]]:
    return [{"title": "Stub filing", "query": query, "source": "edgar-stub"}][:max(1, limit)]
