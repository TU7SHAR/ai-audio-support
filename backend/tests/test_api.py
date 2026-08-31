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


@respx.mock
def test_health_reports_web_search_flag():
    respx.get(f"{settings.ollama_base_url}/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "qwen2.5:3b"}]})
    )
    r = client.get("/health")
    assert "web_search_enabled" in r.json()


@respx.mock
def test_chat_with_language_still_works():
    # Language just tweaks the system prompt; the reply is whatever Ollama returns.
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"role": "assistant", "content": "नमस्ते!"}}
        )
    )
    r = client.post("/chat", json={"message": "hello", "language": "hi"})
    assert r.status_code == 200
    assert r.json()["reply"] == "नमस्ते!"


@respx.mock
def test_chat_uses_web_search_when_enabled(monkeypatch):
    # Pretend a Brave key is configured.
    monkeypatch.setattr(settings, "brave_api_key", "test-key")

    respx.get(settings.brave_endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "title": "Example",
                            "url": "https://example.com",
                            "description": "Some live fact.",
                        }
                    ]
                }
            },
        )
    )
    # The model echoes; we only care that search ran and the flag is set.
    captured = {}

    def _capture(request):
        captured["body"] = request.content.decode()
        return httpx.Response(
            200, json={"message": {"role": "assistant", "content": "Answer from search."}}
        )

    respx.post(f"{settings.ollama_base_url}/api/chat").mock(side_effect=_capture)

    r = client.post("/chat", json={"message": "what is X", "web_search": True})
    assert r.status_code == 200
    assert r.json()["used_web_search"] is True
    # The search context should have been injected into the prompt.
    assert "SEARCH RESULTS" in captured["body"]


@respx.mock
def test_web_search_skipped_without_key(monkeypatch):
    monkeypatch.setattr(settings, "brave_api_key", "")
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"role": "assistant", "content": "No search."}}
        )
    )
    r = client.post("/chat", json={"message": "hi", "web_search": True})
    assert r.status_code == 200
    assert r.json()["used_web_search"] is False


@respx.mock
def test_chat_returns_citations(monkeypatch):
    monkeypatch.setattr(settings, "brave_api_key", "test-key")
    respx.get(settings.brave_endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "title": "Puma page",
                            "url": "https://puma.com/x",
                            "description": "Details.",
                            "extra_snippets": ["More detail one.", "More detail two."],
                        }
                    ]
                }
            },
        )
    )
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"content": "Answer [1]."}}
        )
    )
    r = client.post("/chat", json={"message": "puma", "web_search": True})
    body = r.json()
    assert body["used_web_search"] is True
    assert body["citations"] == [{"n": 1, "title": "Puma page", "url": "https://puma.com/x"}]


@respx.mock
def test_history_is_trimmed(monkeypatch):
    # Force a tiny budget so trimming clearly happens.
    monkeypatch.setattr(settings, "max_history_turns", 2)
    captured = {}

    def _capture(request):
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"message": {"content": "ok"}})

    respx.post(f"{settings.ollama_base_url}/api/chat").mock(side_effect=_capture)

    history = [
        {"role": "user", "content": "one"},
        {"role": "assistant", "content": "two"},
        {"role": "user", "content": "three"},
        {"role": "assistant", "content": "four"},
    ]
    r = client.post("/chat", json={"message": "now", "history": history})
    assert r.status_code == 200
    body = json.loads(captured["body"])
    # system + 2 trimmed history turns + current user message = 4
    assert len(body["messages"]) == 4
    # Oldest turns ("one", "two") should have been dropped.
    contents = [m["content"] for m in body["messages"]]
    assert "one" not in contents
    assert "four" in contents


@respx.mock
def test_chat_stream_sets_citation_headers(monkeypatch):
    monkeypatch.setattr(settings, "brave_api_key", "test-key")
    respx.get(settings.brave_endpoint).mock(
        return_value=httpx.Response(
            200,
            json={"web": {"results": [{"title": "T", "url": "https://a.com", "description": "d"}]}},
        )
    )
    respx.post(f"{settings.ollama_base_url}/api/chat").mock(
        return_value=httpx.Response(
            200, text=json.dumps({"message": {"content": "hi"}, "done": True})
        )
    )
    with client.stream("POST", "/chat/stream", json={"message": "q", "web_search": True}) as resp:
        assert resp.headers.get("x-used-web-search") == "1"
        cites = json.loads(resp.headers.get("x-citations"))
        assert cites[0]["url"] == "https://a.com"
        _ = "".join(resp.iter_text())
