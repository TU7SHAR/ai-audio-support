"""
Thin async client for talking to Ollama's HTTP API.

We keep all Ollama-specific details in here so the rest of the app just calls
`generate_reply(...)` or `stream_reply(...)` and never worries about the wire
format. If you later swap Ollama for something else, this is the only file to
change.
"""

from typing import AsyncGenerator

import httpx

from .config import settings


# Human-readable names for language codes, so we can instruct the model clearly.
_LANG_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "pa": "Punjabi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ar": "Arabic",
    "zh": "Chinese",
}


def _language_instruction(language: str | None) -> str:
    """Build an explicit 'reply in this language' instruction.

    `language` is a code like 'hi' or a BCP-47 tag like 'hi-IN'. If it's None or
    'auto', we let the model mirror whatever language the user wrote in.
    """
    if not language or language.lower() in ("auto", ""):
        return ""
    code = language.split("-")[0].lower()
    name = _LANG_NAMES.get(code)
    if not name:
        return ""
    return f"Reply ONLY in {name}. The user prefers {name}."


def _build_messages(
    user_text: str,
    history: list[dict] | None,
    language: str | None = None,
    search_context: str | None = None,
) -> list[dict]:
    """Assemble the chat message list Ollama expects.

    Structure: a system prompt (plus optional language + search instructions),
    then prior turns, then the new user message.
    """
    system = settings.system_prompt
    lang_hint = _language_instruction(language)
    if lang_hint:
        system = f"{system}\n{lang_hint}"

    messages: list[dict] = [{"role": "system", "content": system}]

    if history:
        for turn in history:
            role = turn.get("role")
            content = turn.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    # If we have live search results, prepend them to the user's message so the
    # model answers from real data rather than guessing.
    if search_context:
        user_content = f"{search_context}\n\nUser question: {user_text}"
    else:
        user_content = user_text

    messages.append({"role": "user", "content": user_content})
    return messages


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
        "options": {"temperature": settings.temperature},
    }

    async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
        resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()

    return data.get("message", {}).get("content", "").strip()


async def stream_reply(
    user_text: str,
    history: list[dict] | None = None,
    language: str | None = None,
    search_context: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream the reply from Ollama one chunk at a time.

    Yields text fragments as the model produces them so the frontend can start
    speaking the first sentence while the rest is still being generated.
    """
    payload = {
        "model": settings.ollama_model,
        "messages": _build_messages(user_text, history, language, search_context),
        "stream": True,
        "options": {"temperature": settings.temperature},
    }

    async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
        async with client.stream(
            "POST", f"{settings.ollama_base_url}/api/chat", json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                import json

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
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
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
