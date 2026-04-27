"""News retrieval tool node scaffold."""

from __future__ import annotations


async def fetch_news(query: str, limit: int = 5) -> list[dict[str, str]]:
    return [{"headline": "Stub market news", "query": query, "source": "news-stub"}][
        : max(1, limit)
    ]
