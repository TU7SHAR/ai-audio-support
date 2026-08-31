"""
Live web search via the Brave Search API.

LLMs can't browse the internet on their own. To answer questions about current
or specific facts, we search the web here and hand the results to the model as
context (this is "retrieval": the model summarizes real results instead of
guessing).

This version returns richer, cleaned results: it pulls Brave's `extra_snippets`
(more text per result), de-duplicates by domain, strips HTML highlight markup,
and biases the query for relevance. It also exposes citations for the UI.

Requires a Brave Search API key (free tier available):
  https://api-dashboard.search.brave.com/
Set it as BRAVE_API_KEY in the backend .env. If unset, search is disabled.
"""

import re

import httpx

from .config import settings

# Brave wraps matched terms in <strong>…</strong>; strip that for clean text.
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    if not text:
        return ""
    text = _TAG_RE.sub("", text)
    return " ".join(text.split()).strip()


async def brave_search(query: str) -> list[dict]:
    """Run a web search and return cleaned, de-duplicated results.

    Each result: {title, url, description, snippets: [..], age}. Returns an
    empty list if search is disabled or the request fails — callers should treat
    "no results" as "answer from your own knowledge".
    """
    if not settings.web_search_enabled:
        return []

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        # Brave uses this custom header for auth (NOT a Bearer token).
        "X-Subscription-Token": settings.brave_api_key.strip(),
    }
    params = {
        "q": query,
        "count": settings.search_results_count,
        "result_filter": "web",
        "country": settings.search_country,
        "search_lang": settings.search_lang,
        # Ask Brave for the longer text snippets — the single "description" is
        # often too thin to answer from.
        "extra_snippets": "true",
        # Drop adult content from support answers.
        "safesearch": "moderate",
    }

    try:
        async with httpx.AsyncClient(timeout=settings.search_timeout) as client:
            resp = await client.get(settings.brave_endpoint, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception:  # noqa: BLE001 - never let search break the chat
        return []

    results: list[dict] = []
    seen_domains: set[str] = set()
    for item in (data.get("web", {}) or {}).get("results", []):
        url = (item.get("url") or "").strip()
        if not url:
            continue
        # De-duplicate by host so we don't feed 4 pages from the same site.
        try:
            domain = url.split("/")[2]
        except IndexError:
            domain = url
        if domain in seen_domains:
            continue
        seen_domains.add(domain)

        snippets = [_clean(s) for s in (item.get("extra_snippets") or []) if _clean(s)]
        results.append(
            {
                "title": _clean(item.get("title", "")),
                "url": url,
                "description": _clean(item.get("description", "")),
                "snippets": snippets[:3],
                "age": item.get("age", "") or item.get("page_age", ""),
            }
        )
        if len(results) >= settings.search_context_count:
            break

    return results


def format_results_for_prompt(results: list[dict]) -> str:
    """Turn search results into a numbered context block for the model prompt.

    Includes the extra snippets so the model has enough real text to synthesize
    a proper answer instead of parroting a one-line description.
    """
    if not results:
        return ""
    lines = [
        "SEARCH RESULTS (answer using ONLY these; synthesize, cite as [n]):",
    ]
    for i, r in enumerate(results, 1):
        block = [f"[{i}] {r['title']}".rstrip()]
        if r.get("age"):
            block[0] += f"  ({r['age']})"
        if r.get("description"):
            block.append(f"    {r['description']}")
        for snip in r.get("snippets", []):
            block.append(f"    - {snip}")
        block.append(f"    Source: {r['url']}")
        lines.append("\n".join(block))
    return "\n".join(lines)


def to_citations(results: list[dict]) -> list[dict]:
    """Compact citation list for the frontend to display under the answer."""
    return [
        {"n": i, "title": r["title"], "url": r["url"]}
        for i, r in enumerate(results, 1)
    ]
