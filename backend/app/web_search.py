"""
Live web search via the Brave Search API.

LLMs can't browse the internet on their own. To answer questions about current
or specific facts, we search the web here and hand the results to the model as
context (this is "retrieval": the model summarizes real results instead of
guessing).

Requires a Brave Search API key (free tier available):
  https://api-dashboard.search.brave.com/
Set it as BRAVE_API_KEY in the backend .env. If unset, search is disabled and
these functions return no results (the app still works, just without live data).
"""

import httpx

from .config import settings


async def brave_search(query: str) -> list[dict]:
    """Run a web search and return a list of {title, url, description} results.

    Returns an empty list if search is disabled or the request fails — callers
    should treat "no results" as "answer from your own knowledge".
    """
    if not settings.web_search_enabled:
        return []

    headers = {
        "Accept": "application/json",
        # Brave uses this custom header for auth (NOT a Bearer token).
        "X-Subscription-Token": settings.brave_api_key.strip(),
    }
    params = {
        "q": query,
        "count": settings.search_results_count,
        # Bias toward text results useful for answering.
        "result_filter": "web",
    }

    try:
        async with httpx.AsyncClient(timeout=settings.search_timeout) as client:
            resp = await client.get(settings.brave_endpoint, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception:  # noqa: BLE001 - never let search break the chat
        return []

    results = []
    for item in (data.get("web", {}) or {}).get("results", [])[: settings.search_results_count]:
        results.append(
            {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "description": item.get("description", ""),
            }
        )
    return results


def format_results_for_prompt(results: list[dict]) -> str:
    """Turn search results into a compact block to inject into the model prompt."""
    if not results:
        return ""
    lines = ["SEARCH RESULTS (use these to answer; cite that it's from a web search):"]
    for i, r in enumerate(results, 1):
        title = r.get("title", "").strip()
        desc = r.get("description", "").strip()
        url = r.get("url", "").strip()
        lines.append(f"{i}. {title}\n   {desc}\n   Source: {url}")
    return "\n".join(lines)
