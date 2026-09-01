# Backend Commands

FastAPI service in `backend/`, sitting in front of Ollama + Qwen.

> **Python version:** the code uses `str | None` annotations → **Python ≥ 3.10
> required**. The sandbox's default `python3` is 3.9 and will error with
> `unsupported operand type(s) for |`. Use 3.11, e.g. `~/.pyenv/versions/3.11.15/bin/python`.

## Set up the environment

```bash
cd backend
~/.pyenv/versions/3.11.15/bin/python -m venv .venv   # 3.10+ required
.venv/bin/pip install -r requirements.txt
```

| Command | What it does | Affects |
|---------|--------------|---------|
| `python -m venv .venv` | Creates an isolated virtualenv | `backend/.venv/` (gitignored) |
| `pip install -r requirements.txt` | Installs runtime deps (fastapi, uvicorn, httpx, pydantic) | the venv |
| `pip install pytest respx` | Installs **test-only** deps (not in requirements.txt) | the venv |

## Prepare the model (Ollama)

```bash
ollama pull qwen2.5:3b   # download the model
ollama list              # confirm it's present
```

## Run the API

```bash
cp .env.example .env      # first time only; edit as needed
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

| Command | What it does | Affects |
|---------|--------------|---------|
| `uvicorn app.main:app --reload` | Runs the API on :8000 with hot reload | serves `/health`, `/chat`, `/chat/stream` |
| `cp .env.example .env` | Creates local config from the template | `backend/.env` (gitignored) |

> ⚠️ Do **not** run long-lived servers in an automated/CI shell — they block.
> Use `--reload` only for interactive local dev.

## Test the API manually

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"Give me a short greeting"}'
```

## Run the automated tests

```bash
cd backend
.venv/bin/python -m pytest -q
```

| Command | What it does | Affects |
|---------|--------------|---------|
| `pytest -q` | Runs `tests/test_api.py` (mocks Ollama via `respx`) | nothing on disk; verifies wiring + **bounded-history** trimming |

Current suite covers: `/health`, `/chat`, `/chat/stream`, empty-message 422,
language pass-through, web-search on/off, and conversation-history trimming
(turn cap, char budget, system-prompt preservation).

## Configuration knobs (`.env` → `app/config.py`)

| Var | Default | Effect |
|-----|---------|--------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Model to use |
| `OLLAMA_TIMEOUT` | `120` | Inference timeout (s) |
| `TEMPERATURE` | `0.4` | Sampling temperature |
| `MAX_HISTORY_TURNS` | `12` | Max prior turns replayed into the prompt (0 = unlimited) |
| `MAX_HISTORY_CHARS` | `6000` | Max total chars of replayed history (0 = unlimited) |
| `BRAVE_API_KEY` | *(empty)* | Enables live web search when set |
| `SEARCH_RESULTS_COUNT` | `4` | Web results fed into the prompt |
| `SEARCH_TIMEOUT` | `15` | Web search timeout (s) |
| `CORS_ORIGINS` | `*` | Allowed browser origins |
