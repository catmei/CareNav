"""Firecrawl Search API utilities for enriching hospital data."""

import os
import asyncio
import logging
import httpx
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (one level up from this file's directory)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/search"

# Five targeted search keyword templates — one per detail category.
# Each {name} placeholder is replaced with the hospital's name at runtime.
HOSPITAL_SEARCH_KEYWORDS = [
    ("{name} hospital specialties services", "specialties_services"),
    ("{name} hospital insurance accepted", "insurance_accepted"),
    ("{name} hospital patient rating review", "patient_rating"),
]

logger = logging.getLogger(__name__)


async def _firecrawl_search(
    client: httpx.AsyncClient,
    query: str,
) -> list[dict] | None:
    """Run a single Firecrawl search and return the top result, or None on failure."""
    api_key = os.getenv("FIRECRAWL_API_KEY", "")
    if not api_key:
        logger.warning("FIRECRAWL_API_KEY is not set")
        return None
    try:
        resp = await client.post(
            FIRECRAWL_API_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"query": query, "limit": 5},
            timeout=20,
        )
        resp.raise_for_status()
        raw = resp.json().get("data", [])
        results = raw if isinstance(raw, list) else raw.get("web", [])
        if not results:
            return None
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "description": r.get("description", ""),
            }
            for r in results
        ]
    except Exception as e:
        logger.error("Firecrawl search failed for query %r: %s", query, e)
        return None


async def firecrawl_search_hospital_details(
    client: httpx.AsyncClient,
    hospital_name: str,
) -> dict:
    """Run all 5 keyword searches for a hospital concurrently.

    Returns a dict with one key per category (see HOSPITAL_SEARCH_KEYWORDS).
    Each value is {title, url, description} or None when no result was found.
    """
    tasks = [
        _firecrawl_search(client, keyword.format(name=hospital_name))
        for keyword, _ in HOSPITAL_SEARCH_KEYWORDS
    ]
    results = await asyncio.gather(*tasks)
    return {
        category: result
        for (_, category), result in zip(HOSPITAL_SEARCH_KEYWORDS, results)
    }
