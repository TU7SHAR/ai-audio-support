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


def _build_messages(user_text: str, history: list[dict] | None) -> list[dict]:
    """Assemble the chat message list Ollama expects.

    Structure: a system prompt, then prior turns (optional), then the new user
    message.
    """
    messages: list[dict] = [{"role": "system", "content": settings.system_prompt}]
    if history:
        for turn in history:
            role = turn.get("role")
            content = turn.get("content", "")
            # Only forward roles the model understands.
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_text})
    return messages


async def generate_reply(user_text: str, history: list[dict] | None = None) -> str:
    """Send a chat request to Ollama and return the full reply text.

    This waits for the complete answer before returning. Simple and reliable —
    great for Step 1. Streaming (token-by-token) is added separately for the
    real-time voice experience.
    """
    payload = {
        "model": settings.ollama_model,
        "messages": _build_messages(user_text, history),
        "stream": False,
        "options": {"temperature": settings.temperature},
    }

    async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
        resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()

    # Ollama's /api/chat returns {"message": {"role": "assistant", "content": "..."}}
    return data.get("message", {}).get("content", "").strip()


async def stream_reply(
    user_text: str, history: list[dict] | None = None
) -> AsyncGenerator[str, None]:
    """Stream the reply from Ollama one chunk at a time.

    Yields text fragments as the model produces them. This is what makes the
    voice agent feel real-time: the frontend can start speaking the first
    sentence while the rest is still being generated.
    """
    payload = {
        "model": settings.ollama_model,
        "messages": _build_messages(user_text, history),
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
                # Each line is a standalone JSON object.
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
    """Ping Ollama and report whether our configured model is available.

    Used by the /health endpoint so you can debug setup issues quickly.
    """
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
