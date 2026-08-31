"""
Thin async client for talking to Ollama's HTTP API.

We keep all Ollama-specific details in here so the rest of the app just calls
`generate_reply(...)` or `stream_reply(...)` and never worries about the wire
format. If you later swap Ollama for something else, this is the only file to
change.

Efficiency notes:
  - A single shared httpx.AsyncClient is reused across requests (connection
    pooling) instead of opening a new one every call.
  - We send Ollama `num_ctx` (context size) and `keep_alive` so the model stays
    warm in RAM between messages — the cold reload is the slowest part on CPU.
  - History is trimmed to a recent window + char budget before sending, so
    prompts stay small and fast and never overflow the context window.
"""

import json
from typing import AsyncGenerator

import httpx

from .config import settings


# --- Shared HTTP client (connection pooling) -------------------------------
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.ollama_base_url,
            timeout=settings.ollama_timeout,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _client


async def close_client() -> None:
    """Close the shared client on app shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


# Human-readable names for language codes, so we can instruct the model clearly.
_LANG_NAMES = {
    "en": "English", "hi": "Hindi", "pa": "Punjabi", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati",
    "es": "Spanish", "fr": "French", "de": "German", "ar": "Arabic",
    "zh": "Chinese",
}


def _language_instruction(language: str | None) -> str:
    """Build an explicit 'reply in this language' instruction."""
    if not language or language.lower() in ("auto", ""):
        return ""
    code = language.split("-")[0].lower()
    name = _LANG_NAMES.get(code)
    if not name:
        return ""
    return f"Reply ONLY in {name}. The user prefers {name}."


def _trim_history(history: list[dict] | None) -> list[dict]:
    """Keep only recent, valid turns within the configured budgets.

    Context management: we cap the number of turns AND the total characters so
    the prompt stays small (faster inference, no context overflow). We keep the
    MOST RECENT turns since those matter most for the current question.
    """
    if not history:
        return []

    valid = [
        {"role": t.get("role"), "content": t.get("content", "")}
        for t in history
        if t.get("role") in ("user", "assistant") and t.get("content")
    ]
    # Most recent N turns.
    valid = valid[-settings.max_history_turns :]

    # Then enforce a char budget, dropping oldest until we fit.
    total = sum(len(t["content"]) for t in valid)
    while valid and total > settings.max_history_chars:
        removed = valid.pop(0)
        total -= len(removed["content"])
    return valid


def _build_messages(
    user_text: str,
    history: list[dict] | None,
    language: str | None = None,
    search_context: str | None = None,
) -> list[dict]:
    """Assemble the (trimmed) chat message list Ollama expects."""
    system = settings.system_prompt
    lang_hint = _language_instruction(language)
    if lang_hint:
        system = f"{system}\n{lang_hint}"

    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(_trim_history(history))

    if search_context:
        user_content = f"{search_context}\n\nUser question: {user_text}"
    else:
        user_content = user_text

    messages.append({"role": "user", "content": user_content})
    return messages


def _options() -> dict:
    """Ollama sampling/runtime options."""
    return {
        "temperature": settings.temperature,
        "num_ctx": settings.num_ctx,
    }


async def generate_reply(
    user_text: str,
    history: list[dict] | None = None,
    language: str | None = None,
    search_context: str | None = None,
) -> str:
    """Send a chat request to Ollama and return the full reply text."""
    payload = {
        "model": settings.ollama_model,
        "messages": _build_messages(user_text, history, language, search_context),
        "stream": False,
        "options": _options(),
        "keep_alive": settings.keep_alive,
    }
    resp = await _get_client().post("/api/chat", json=payload)
    resp.raise_for_status()
    data = resp.json()
    return data.get("message", {}).get("content", "").strip()


async def stream_reply(
    user_text: str,
    history: list[dict] | None = None,
    language: str | None = None,
    search_context: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream the reply from Ollama one chunk at a time."""
    payload = {
        "model": settings.ollama_model,
        "messages": _build_messages(user_text, history, language, search_context),
        "stream": True,
        "options": _options(),
        "keep_alive": settings.keep_alive,
    }

    async with _get_client().stream("POST", "/api/chat", json=payload) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            chunk = obj.get("message", {}).get("content", "")
            if chunk:
                yield chunk
            if obj.get("done"):
                break


async def check_ollama() -> dict:
    """Ping Ollama and report whether our configured model is available."""
    result = {"ollama_reachable": False, "model_present": False, "models": []}
    try:
        resp = await _get_client().get("/api/tags", timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        result["ollama_reachable"] = True
        names = [m.get("name", "") for m in data.get("models", [])]
        result["models"] = names
        result["model_present"] = any(
            n == settings.ollama_model or n.startswith(settings.ollama_model)
            for n in names
        )
    except Exception as exc:  # noqa: BLE001 - health check should never raise
        result["error"] = str(exc)
    return result
