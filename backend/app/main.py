"""
AI Audio Support — Backend API.

This FastAPI service is the "brain's front door". The browser frontend sends
transcribed text here; we forward it to the local Ollama/Qwen model and return
the reply. Ollama itself stays private on localhost — only this API is exposed.

Features:
  - Multi-language: pass `language` to have the model reply in that language.
  - Web search: pass `web_search: true` to fetch live Brave results and answer
    from them (requires BRAVE_API_KEY; otherwise it's silently skipped).

Endpoints:
  GET  /health        -> service + Ollama + web-search status
  POST /chat          -> {reply} for a single message (waits for full answer)
  POST /chat/stream   -> streams the reply token-by-token (for real-time voice)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import settings
from .ollama_client import check_ollama, generate_reply, stream_reply
from .web_search import brave_search, format_results_for_prompt

app = FastAPI(
    title="AI Audio Support API",
    description="Text-in / text-out support agent backed by local Ollama + Qwen.",
    version="0.2.0",
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


class ChatResponse(BaseModel):
    reply: str
    model: str
    used_web_search: bool = False


# --- Helpers ---------------------------------------------------------------
async def _maybe_search(req: ChatRequest) -> tuple[str | None, bool]:
    """Run web search if requested and enabled. Returns (context, used)."""
    if not req.web_search or not settings.web_search_enabled:
        return None, False
    results = await brave_search(req.message)
    if not results:
        return None, False
    return format_results_for_prompt(results), True


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
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Return the full reply for a single message (blocks until complete)."""
    history = [t.model_dump() for t in req.history] if req.history else None
    search_context, used = await _maybe_search(req)
    reply = await generate_reply(req.message, history, req.language, search_context)
    return ChatResponse(reply=reply, model=settings.ollama_model, used_web_search=used)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream the reply as plain-text chunks.

    The frontend reads this incrementally so it can start speaking sooner.
    When web search is used, the results are fetched first (this adds a short
    delay before the first token), then the answer streams normally.
    """
    history = [t.model_dump() for t in req.history] if req.history else None
    search_context, _used = await _maybe_search(req)

    async def token_generator():
        async for chunk in stream_reply(req.message, history, req.language, search_context):
            yield chunk

    return StreamingResponse(token_generator(), media_type="text/plain; charset=utf-8")
