"""A tiny stand-in for Ollama, used only to verify the API wiring locally.

Not part of the deployment — it just mimics the two Ollama endpoints the app
uses (/api/tags and /api/chat) so we can test /health, /chat and /chat/stream
without downloading a real model.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


@app.get("/api/tags")
async def tags():
    return {"models": [{"name": "qwen2.5:3b"}]}


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    user = body["messages"][-1]["content"]
    reply = f"(fake) You said: {user}"

    if not body.get("stream"):
        return {"message": {"role": "assistant", "content": reply}}

    async def gen():
        for word in reply.split():
            yield json.dumps({"message": {"content": word + " "}, "done": False}) + "\n"
        yield json.dumps({"message": {"content": ""}, "done": True}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
