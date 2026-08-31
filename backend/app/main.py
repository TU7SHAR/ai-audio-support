"""
AI Audio Support — Backend API.

This FastAPI service is the "brain's front door". The browser frontend sends
transcribed text here; we forward it to the local Ollama/Qwen model and return
the reply. Ollama itself stays private on localhost — only this API is exposed.

Features:
  - Multi-language: pass `language` to have the model reply in that language.
  - Web search: pass `web_search: true` to fetch live Brave results and answer
    from them (requires BRAVE_API_KEY; otherwise it's silently skipped).
  - Context management: history is trimmed to a recent window before sending.
  - Efficiency: shared HTTP client, warm model (keep_alive), a concurrency guard
    so the CPU-only model isn't overwhelmed by simultaneous requests.

Endpoints:
  GET  /health        -> service + Ollama + web-search status
  POST /chat          -> {reply, citations} for a single message
  POST /chat/stream   -> streams the reply token-by-token; citations via header
"""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import settings
from .ollama_client import check_ollama, close_client, generate_reply, stream_reply
from .web_search import brave_search, format_results_for_prompt, to_citations


# The CPU-only model realistically handles one generation at a time. This
# semaphore serializes heavy work so concurrent callers queue instead of
# thrashing the CPU (each waits its turn rather than all slowing to a crawl).
_gen_semaphore = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Clean up the shared HTTP client on shutdown.
    await close_client()


app = FastAPI(
    title="AI Audio Support API",
    description="Text-in / text-out support agent backed by local Ollama + Qwen.",
    version="0.3.0",
    lifespan=lifespan,
)

# Allow the browser frontend (Vercel) to call this API.
origins = ["*"] if settings.cors_origins.strip() == "*" else [
    o.strip() for o in settings.cors_origins.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expose our custom header so the browser can read citations from streaming.
    expose_headers=["X-Citations", "X-Used-Web-Search"],
)


# --- Request/response models ----------------------------------------------
class ChatTurn(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="The user's message text.")
    history: list[ChatTurn] | None = Field(
        default=None, description="Optional prior conversation turns for context."
    )
    language: str | None = Field(
        default=None,
        description="Language code/tag to reply in (e.g. 'hi', 'pa', 'en'). "
        "Omit or 'auto' to mirror the user's language.",
    )
    web_search: bool = Field(
        default=False,
        description="If true (and a Brave key is configured), fetch live web "
        "results and answer from them.",
    )


class Citation(BaseModel):
    n: int
    title: str
    url: str


class ChatResponse(BaseModel):
    reply: str
    model: str
    used_web_search: bool = False
    citations: list[Citation] = []


# --- Helpers ---------------------------------------------------------------
async def _maybe_search(req: ChatRequest):
    """Run web search if requested and enabled.

    Returns (context_text, used, citations).
    """
    if not req.web_search or not settings.web_search_enabled:
        return None, False, []
    results = await brave_search(req.message)
    if not results:
        return None, False, []
    return format_results_for_prompt(results), True, to_citations(results)


# --- Routes ----------------------------------------------------------------
@app.get("/health")
async def health():
    """Report API + Ollama + web-search status."""
    ollama = await check_ollama()
    return {
        "status": "ok",
        "model": settings.ollama_model,
        "ollama": ollama,
        "web_search_enabled": settings.web_search_enabled,
        "num_ctx": settings.num_ctx,
        "max_history_turns": settings.max_history_turns,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Return the full reply for a single message (blocks until complete)."""
    history = [t.model_dump() for t in req.history] if req.history else None
    search_context, used, citations = await _maybe_search(req)
    async with _gen_semaphore:
        reply = await generate_reply(req.message, history, req.language, search_context)
    return ChatResponse(
        reply=reply,
        model=settings.ollama_model,
        used_web_search=used,
        citations=citations,
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream the reply as plain-text chunks.

    Web search (if any) runs first, then tokens stream. Citations are returned
    in the `X-Citations` response header (JSON), since the body is plain text.
    """
    history = [t.model_dump() for t in req.history] if req.history else None
    search_context, used, citations = await _maybe_search(req)

    async def token_generator():
        async with _gen_semaphore:
            async for chunk in stream_reply(
                req.message, history, req.language, search_context
            ):
                yield chunk

    headers = {
        "X-Used-Web-Search": "1" if used else "0",
        "X-Citations": json.dumps(citations),
    }
    return StreamingResponse(
        token_generator(), media_type="text/plain; charset=utf-8", headers=headers
    )
