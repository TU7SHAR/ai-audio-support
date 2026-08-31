"""
AI Audio Support — Backend API.

This FastAPI service is the "brain's front door". The browser frontend sends
transcribed text here; we forward it to the local Ollama/Qwen model and return
the reply. Ollama itself stays private on localhost — only this API is exposed.

Endpoints:
  GET  /health        -> service + Ollama status (useful for debugging)
  POST /chat          -> {reply} for a single message (waits for full answer)
  POST /chat/stream   -> streams the reply token-by-token (for real-time voice)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import settings
from .ollama_client import check_ollama, generate_reply, stream_reply

app = FastAPI(
    title="AI Audio Support API",
    description="Text-in / text-out support agent backed by local Ollama + Qwen.",
    version="0.1.0",
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


class ChatResponse(BaseModel):
    reply: str
    model: str


# --- Routes ----------------------------------------------------------------
@app.get("/health")
async def health():
    """Report whether the API is up and whether Ollama + the model are ready."""
    ollama = await check_ollama()
    return {
        "status": "ok",
        "model": settings.ollama_model,
        "ollama": ollama,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Return the full reply for a single message (blocks until complete)."""
    history = [t.model_dump() for t in req.history] if req.history else None
    reply = await generate_reply(req.message, history)
    return ChatResponse(reply=reply, model=settings.ollama_model)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream the reply as plain-text chunks (newline-delimited).

    The frontend reads this incrementally so it can start speaking sooner.
    """
    history = [t.model_dump() for t in req.history] if req.history else None

    async def token_generator():
        async for chunk in stream_reply(req.message, history):
            yield chunk

    return StreamingResponse(token_generator(), media_type="text/plain; charset=utf-8")
