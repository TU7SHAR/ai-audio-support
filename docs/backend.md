# Backend

A small **FastAPI** service that sits in front of a local **Ollama + Qwen** model.
The browser sends transcribed text here; this service asks Qwen and returns the
reply (full or streamed).

```
Browser ──HTTP(S)──▶ This API (:8000, public) ──▶ Ollama (127.0.0.1:11434) ──▶ Qwen2.5:3b
```

## File map (`backend/app/`)

| File | Responsibility |
|------|----------------|
| `main.py` | FastAPI app, routes, request/response models, CORS, web-search glue |
| `config.py` | Pydantic settings from `.env` (Ollama, model behaviour, Brave, CORS) |
| `ollama_client.py` | The **only** file that knows Ollama's wire format; message assembly + streaming |
| `web_search.py` | Optional Brave Search retrieval, formatted into prompt context |

Other: `deploy/ai-support-api.service` (systemd unit), `tests/` (API tests),
`requirements.txt`, `.env.example`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | API status + whether Ollama and the model are up + web-search flag |
| `POST` | `/chat` | Send `{message}`, get full `{reply, model, used_web_search}` |
| `POST` | `/chat/stream` | Same input; streams the reply as plain-text chunks |

Request body:

```json
{
  "message": "Hi, I need help with my order",
  "history": [
    { "role": "user", "content": "earlier message" },
    { "role": "assistant", "content": "earlier reply" }
  ],
  "language": "hi",
  "web_search": true
}
```

- `history` (optional) — prior turns for context. **Currently replayed in full.**
- `language` (optional) — reply language code (`en`, `hi`, `pa`, …). `auto`/omit
  mirrors the user's language.
- `web_search` (optional) — if `true` **and** a Brave key is set, fetch live
  results and answer from them.

## How the prompt is built (`ollama_client.py::_build_messages`)

```
[system prompt]  (+ language instruction if a language is chosen)  ← always kept
[history turns]  (user/assistant, in order — BOUNDED by _trim_history)
[user message]   (prefixed with SEARCH RESULTS block if web search ran)
```

`_trim_history()` bounds the replayed history: it drops empty/invalid turns,
keeps the last `MAX_HISTORY_TURNS`, then trims oldest-first to fit
`MAX_HISTORY_CHARS`. The system prompt is added separately and never trimmed.

`generate_reply()` calls Ollama `/api/chat` with `stream:false`;
`stream_reply()` uses `stream:true` and yields content chunks as they arrive.
`check_ollama()` pings `/api/tags` to report reachability + model presence.

## Configuration (`.env`, see `.env.example`)

| Var | Default | Notes |
|-----|---------|-------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Must match a model in `ollama list` |
| `OLLAMA_TIMEOUT` | `120` | Seconds; CPU inference can be slow |
| `TEMPERATURE` | `0.4` | Lower = more focused answers |
| `MAX_HISTORY_TURNS` | `12` | Max prior turns replayed into the prompt (0 = unlimited) |
| `MAX_HISTORY_CHARS` | `6000` | Max total chars of replayed history (0 = unlimited) |
| `BRAVE_API_KEY` | *(empty)* | Enables web search when set |
| `SEARCH_RESULTS_COUNT` | `4` | Results fed into the prompt |
| `SEARCH_TIMEOUT` | `15` | Search request timeout (s) |
| `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins |

The system prompt keeps the model concise, on-task, in the user's language, and
instructs it **not to invent facts** and to cite when answering from search.

## Tests (`tests/test_api.py`)

Uses `respx` to mock Ollama's HTTP calls (no real model needed). Covers:
`/health` (model present + web-search flag), `/chat` reply, `/chat/stream`
chunking, empty-message rejection (422), language pass-through, and both
web-search paths (enabled vs. no key).

Run:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install pytest respx        # test-only deps
pytest
```

## Known gaps / notes

- **Stateless sessions:** no server-side session identity yet (memory still held
  by the client); see [`conversation-memory.md`](./conversation-memory.md).
- **Bounded history ✅:** replayed history is now capped server-side
  (`_trim_history`), which removes the context-window/latency risk. Client
  history is still trusted for *content* (forged-history vector remains).
- **`/chat/stream` doesn't signal `used_web_search`** to the client (only
  `/chat` does). The UI's "searching…" hint is based on the toggle, not reality.
