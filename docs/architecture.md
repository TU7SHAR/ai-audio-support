# Architecture

The system is a **monorepo with two independently deployable halves** ("phases").

```
┌─────────────────────────────┐         ┌──────────────────────────────────────┐
│  PHASE 2 — Frontend          │         │  PHASE 1 — Backend (Oracle server)     │
│  Next.js (App Router)        │         │                                        │
│  Deployed on Vercel (HTTPS)  │         │  ┌──────────────┐   ┌───────────────┐  │
│                              │  HTTPS  │  │ FastAPI       │   │ Ollama        │  │
│  🎤 Web Speech API (STT)     │ tunnel  │  │ (public :8000)│──▶│ 127.0.0.1     │  │
│  🔊 Web Speech API (TTS)     │────────▶│  │ /chat         │   │ :11434        │  │
│                              │         │  │ /chat/stream  │   │ Qwen2.5:3b    │  │
│  app/page.js  (UI + queue)   │         │  │ /health       │   └───────────────┘  │
│  lib/api.js   (fetch helpers)│         │  └──────┬────────┘                       │
│  lib/useSpeech.js (voice)    │         │         │ optional                       │
└─────────────────────────────┘         │         ▼                                │
                                         │   Brave Search API (live web results)    │
                                         └──────────────────────────────────────────┘
```

## The two phases

| | Phase 1 — Backend | Phase 2 — Frontend |
|-|-------------------|--------------------|
| **Tech** | FastAPI (Python) + Ollama | Next.js 16 (App Router) + React 19 |
| **Host** | Oracle Cloud free ARM (CPU-only) | Vercel |
| **Role** | Safe public front door to the private model | Voice UI: mic, speaker, chat |
| **Exposure** | Public via tunnel/HTTPS; Ollama stays localhost | Public HTTPS site |
| **Details** | [`backend.md`](./backend.md) | [`frontend.md`](./frontend.md) |

## Request/response data flow

1. User speaks → browser `SpeechRecognition` produces final transcript.
2. `page.js` builds `history` from current messages, calls `streamChat()`.
3. `lib/api.js` → `POST {API_BASE_URL}/chat/stream` with
   `{ message, history, language, web_search }`.
4. Backend `main.py`:
   - Optionally runs Brave search (`_maybe_search`) and formats results.
   - Calls `stream_reply()` which builds the Ollama message list
     (system prompt + language hint + optional search context + history + user
     text) and streams from Ollama's `/api/chat`.
5. Backend returns a `StreamingResponse` of **plain text** chunks.
6. Frontend reads the stream, slices completed **sentences**, speaks each aloud
   while revealing its text word-by-word in sync.

## Why a service in front of Ollama

Ollama listens on `127.0.0.1` only and must **never** be exposed directly. The
FastAPI service is the controlled, public front door where we own prompts, CORS,
language handling, web-search retrieval, and (later) auth, rate limits, and
sessions.

## Deployment topology

- **Backend** runs as a `systemd` unit (`deploy/ai-support-api.service`) that
  waits for `ollama.service`, so it restarts on crash/reboot.
- **Frontend** is a standard Vercel deploy with **Root Directory = `frontend`**
  (monorepo) and `NEXT_PUBLIC_API_BASE_URL` pointing at the backend's public URL.
- **The bridge** is a tunnel (temporary HTTPS URL) or, ideally, a domain +
  reverse proxy (Caddy/Nginx) with HTTPS. See [`operations.md`](./operations.md).

## Cross-cutting concerns

- **CORS:** configured in the backend via `CORS_ORIGINS` (defaults to `*` for
  prototyping; set to the Vercel URL in production).
- **Mixed content:** an HTTPS Vercel page cannot call an `http://` API. The
  backend URL must be HTTPS.
- **Statelessness:** the backend is currently **stateless** — all conversation
  memory lives in the browser and is replayed on every request. See
  [`conversation-memory.md`](./conversation-memory.md).
