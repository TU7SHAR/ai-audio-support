"""Wiring tests for the API.

These mock the Ollama HTTP calls so we can verify /health, /chat and
/chat/stream without a real model running.
"""

import json

import httpx
import respx
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings

client = TestClient(app)


@respx.mock
def test_health_reports_model_present():
    respx.get(f"{settings.ollama_base_url}/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "qwen2.5:3b"}]})
    )
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["ollama"]["ollama_reachable"] is True
    assert body["ollama"]["model_present"] is True


@respx.mock
def test_chat_returns_reply():
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"role": "assistant", "content": "Hi! How can I help?"}}
        )
    )
    r = client.post("/chat", json={"message": "hello"})
    assert r.status_code == 200
    assert r.json()["reply"] == "Hi! How can I help?"


@respx.mock
def test_chat_stream_yields_chunks():
    lines = [
        json.dumps({"message": {"content": "Hello "}, "done": False}),
        json.dumps({"message": {"content": "there"}, "done": False}),
        json.dumps({"message": {"content": ""}, "done": True}),
    ]
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(200, text="\n".join(lines))
    )
    with client.stream("POST", "/chat/stream", json={"message": "hi"}) as resp:
        assert resp.status_code == 200
        text = "".join(chunk for chunk in resp.iter_text())
    assert text == "Hello there"


def test_chat_rejects_empty_message():
    r = client.post("/chat", json={"message": ""})
    assert r.status_code == 422
