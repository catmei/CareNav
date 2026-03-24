"""Firecrawl Search API utilities for enriching hospital data."""

import os
import json
import asyncio
import logging
import httpx
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (one level up from this file's directory)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/search"

logger = logging.getLogger(__name__)


async def _firecrawl_search(
    client: httpx.AsyncClient,
    query: str,
) -> list[dict] | None:
    """Run a single Firecrawl search and return the top results, or None on failure."""
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


def _format_results(results: list[dict] | None) -> str:
    """Format a list of search results into compact text lines."""
    if not results:
        return ""
    lines = []
    for r in results:
        title = r.get("title", "")
        desc = r.get("description", "")
        if title and desc:
            lines.append(f"  - {title}: {desc}")
        elif title:
            lines.append(f"  - {title}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Layer 1 — Triage-informed search per hospital (runs after triage)
# ---------------------------------------------------------------------------


def _build_l1_queries(hospital_name: str, triage_data: dict) -> list[tuple[str, str]]:
    """Build Layer 1 search queries combining hospital name + triage info."""
    symptoms = triage_data.get("symptoms", "")
    insurance = triage_data.get("insurance", "")

    queries = []

    # Symptom/specialty match
    if symptoms:
        queries.append(
            (f"{hospital_name} {symptoms} treatment services specialties", "Symptom Match")
        )

    # Insurance compatibility (if user has insurance)
    has_insurance = insurance and insurance.lower() not in ("none", "no", "no insurance", "skipped", "")
    if has_insurance:
        queries.append(
            (f"{hospital_name} {insurance} insurance accepted", "Insurance Match")
        )

    # Patient reviews (always)
    queries.append(
        (f"{hospital_name} hospital patient rating review", "Patient Reviews")
    )

    return queries


async def firecrawl_search_l1(
    client: httpx.AsyncClient,
    hospitals: list[dict],
    triage_data: dict,
) -> str:
    """Layer 1: run triage-informed searches for each hospital after triage.

    Returns a formatted string grouped by hospital for the agent.
    """
    # Build all search tasks: (hospital_index, label, query)
    work: list[tuple[int, str, str]] = []
    for idx, h in enumerate(hospitals):
        for query, label in _build_l1_queries(h["name"], triage_data):
            work.append((idx, label, query))

    # Run all searches concurrently
    tasks = [_firecrawl_search(client, query) for _, _, query in work]
    results = await asyncio.gather(*tasks)

    # # Save raw results for inspection
    # raw_data = []
    # for (idx, label, query), result in zip(work, results):
    #     raw_data.append({
    #         "hospital": hospitals[idx]["name"],
    #         "label": label,
    #         "query": query,
    #         "results": result,
    #     })
    # cache_path = Path(__file__).resolve().parent / "cached_l1_search_results.json"
    # cache_path.write_text(
    #     json.dumps(raw_data, indent=2, ensure_ascii=False),
    #     encoding="utf-8",
    # )
    # logger.info("Saved Layer 1 search results to %s", cache_path)

    # Group results by hospital
    hospital_sections: dict[int, list[str]] = {}
    for (idx, label, _query), result in zip(work, results):
        formatted = _format_results(result)
        if formatted:
            hospital_sections.setdefault(idx, []).append(
                f"[{label}]:\n{formatted}"
            )

    # Build final formatted string
    parts: list[str] = []
    for idx, h in enumerate(hospitals):
        sections = hospital_sections.get(idx)
        if not sections:
            continue
        header = f"=== {h['name']} ({h.get('distance_miles', '?')} mi) ==="
        parts.append(header + "\n" + "\n\n".join(sections))

    return "\n\n".join(parts) if parts else "No search results found for the nearby hospitals."


# ---------------------------------------------------------------------------
# Layer 2 — Agent-driven refined search (runs after follow-up questions)
# ---------------------------------------------------------------------------


async def firecrawl_search_l2(
    client: httpx.AsyncClient,
    query: str,
) -> str:
    """Layer 2: run a single refined search with the agent's free-text query.

    Returns a formatted string of results for the agent.
    """
    results = await _firecrawl_search(client, query)

    # # Save for inspection
    # cache_path = Path(__file__).resolve().parent / "cached_l2_search_results.json"
    # cache_path.write_text(
    #     json.dumps({"query": query, "results": results}, indent=2, ensure_ascii=False),
    #     encoding="utf-8",
    # )
    # logger.info("Saved Layer 2 search results to %s", cache_path)

    formatted = _format_results(results)
    return formatted if formatted else "No additional search results found."
