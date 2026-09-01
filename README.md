# AI Audio Support

A prototype **real-time AI voice customer support** agent.

A user speaks a question; the assistant answers back — like being on a call. It
runs on a self-hosted open model ([Qwen](https://ollama.com/library/qwen2.5) via
[Ollama](https://ollama.com)), so there are no per-request API costs.

## How it works

```
🎤 user speaks
   → speech-to-text        (in the browser)
   → POST /chat  ─────────▶ Backend API ──▶ Ollama + Qwen   (on the server)
   ← reply text ◀─────────
   → text-to-speech        (in the browser)
🔊 assistant speaks
```

The heavy lifting (the language model) stays on the server. The browser handles
the microphone and speaker. The backend API is the safe public front door in
front of Ollama.

## Repository layout

This is a monorepo with two independently deployable parts:

| Folder      | What it is                        | Deploys to        |
|-------------|-----------------------------------|-------------------|
| `frontend/` | Next.js chat/voice UI             | **Vercel**        |
| `backend/`  | FastAPI service in front of Ollama | **Oracle server** |

Each folder has its own README with setup and deploy instructions:

- [`frontend/README.md`](./frontend/README.md)
- [`backend/README.md`](./backend/README.md)

## Documentation

Deeper project documentation — architecture, per-service details, the
conversation-memory analysis, roadmap, and decision records — lives in
[`docs/`](./docs/README.md). Start at [`docs/README.md`](./docs/README.md).

## Quick start (local)

**1. Backend** (needs Ollama + a pulled model):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**2. Frontend** (in another terminal):

```bash
cd frontend
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000 and start chatting.

## Roadmap

- [x] **Step 1** — Backend `/chat` API backed by Ollama/Qwen + basic chat UI
- [ ] **Step 2** — Streaming replies wired into the UI (partially in place)
- [ ] **Step 3** — Microphone input (browser speech-to-text)
- [ ] **Step 4** — Spoken replies (browser text-to-speech) + interruptions
- [ ] **Step 5** — Support knowledge base / FAQ grounding

## Notes on the current model host

- Oracle Cloud free ARM instance, **CPU-only** (no GPU).
- `qwen2.5:3b` is the sweet spot here — bigger models get slow on CPU.
- Full answers can take a few seconds; response **streaming** is what makes it
  feel real-time, which is why the API and UI are built around it.
