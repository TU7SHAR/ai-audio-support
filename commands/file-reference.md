# File Reference

What every source and config file in the repo does. Update this whenever a file
is added, removed, or meaningfully changed.

## Backend (`backend/`)

| File | What it does |
|------|--------------|
| `app/main.py` | FastAPI app: routes (`/health`, `/chat`, `/chat/stream`), request/response models, CORS, web-search glue |
| `app/config.py` | Pydantic settings from `.env`: Ollama, temperature, **history bounds** (`MAX_HISTORY_TURNS`, `MAX_HISTORY_CHARS`), Brave, CORS |
| `app/ollama_client.py` | Talks to Ollama; builds the prompt; `_trim_history()` bounds replayed history; `generate_reply`/`stream_reply`/`check_ollama` |
| `app/web_search.py` | Optional Brave Search retrieval, formatted into prompt context |
| `app/__init__.py` | Package marker |
| `tests/test_api.py` | API + bounded-history tests (mocks Ollama via `respx`) |
| `tests/fake_ollama.py` | Test helper standing in for Ollama |
| `deploy/ai-support-api.service` | systemd unit to run the API on the Oracle server |
| `requirements.txt` | Runtime deps (fastapi, uvicorn, httpx, pydantic, pydantic-settings) |
| `.env.example` | Template for `backend/.env` |

## Frontend (`frontend/`)

| File | What it does |
|------|--------------|
| `app/page.js` | Voice-first chat UI: mic, sentence-sync speech queue, settings, localStorage persistence, sends bounded `history` |
| `app/layout.js` | Root layout / shell |
| `app/globals.css` | Global Tailwind v4 styles + animations |
| `lib/api.js` | Backend fetch helpers: `sendChat`, `streamChat`, `getHealth` |
| `lib/useSpeech.js` | Web Speech API hook: STT (`SpeechRecognition`) + TTS (`speechSynthesis`) + `primeSpeech()` |
| `package.json` | Scripts + deps (Next 16, React 19, Tailwind v4) |
| `next.config.mjs` | Next.js config |
| `eslint.config.mjs` | ESLint config |
| `jsconfig.json` | Path aliases (`@/…`) |
| `postcss.config.mjs` | PostCSS / Tailwind pipeline |

## Repo root

| Path | What it does |
|------|--------------|
| `README.md` | Project intro, layout, quick start, links to docs |
| `docs/` | Living project documentation (architecture, memory, roadmap, ADRs, **agent activity log**) |
| `commands/` | This folder — command & file reference |
