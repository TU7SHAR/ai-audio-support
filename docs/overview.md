# Overview

## What it is

**AI Audio Support** is a prototype **real-time AI voice customer-support agent**.
A user speaks a question into their microphone; the assistant answers back in
voice — like being on a phone call. It runs on a self-hosted open model, so there
are no per-request API costs.

## End-to-end flow

```
🎤 user speaks
   → speech-to-text        (in the browser, Web Speech API)
   → POST /chat/stream ───▶ Backend API ──▶ Ollama + Qwen   (on the Oracle server)
   ← reply streams back    (chunk-by-chunk, plain text)
   → text-to-speech        (in the browser, sentence by sentence)
🔊 assistant speaks
```

The heavy lifting (the language model) stays on the server. The browser handles
the microphone and speaker. The backend API is the safe public front door in
front of Ollama (which listens on localhost only).

## Why this design

- **Cost:** self-hosted Qwen via Ollama = no per-token billing.
- **Privacy of the model host:** Ollama is never exposed to the internet; only
  the FastAPI service is public.
- **Perceived speed:** on a CPU-only box, full answers take a few seconds, so
  **streaming** is what makes it feel real-time. The whole API + UI are built
  around streaming.
- **Free audio:** the browser's built-in Web Speech API does STT + TTS — no
  audio services to pay for or integrate.

## Current status (live)

| Capability | State |
|------------|-------|
| `/chat` + `/chat/stream` backed by Ollama/Qwen | ✅ working |
| Streaming replies wired into the UI | ✅ working |
| Microphone input (browser STT) | ✅ working |
| Spoken replies (browser TTS) + Stop/interrupt | ✅ working |
| Multi-language (reply language + mic/voice language) | ✅ working |
| Optional live web search (Brave API) | ✅ working (needs key) |
| Conversation memory | ⚠️ basic (client-side, unbounded) — see [`conversation-memory.md`](./conversation-memory.md) |
| Real server-side sessions | ❌ not yet |
| Support knowledge base / FAQ grounding | ❌ not yet |

## Known constraints

- **Model host:** Oracle Cloud free ARM instance, **CPU-only** (no GPU).
  `qwen2.5:3b` is the sweet spot — bigger models get slow on CPU.
- **Tunnel links are temporary:** the backend is reached via a tunnel URL that
  changes on restart; the Vercel `NEXT_PUBLIC_API_BASE_URL` must be updated when
  it does. See [`operations.md`](./operations.md).
- **Mixed content:** Vercel is HTTPS; the backend URL must also be HTTPS or the
  browser blocks the calls. The UI detects and warns about this.
- **Web Speech API support:** solid in Chrome/Edge, spotty elsewhere, especially
  for non-English (e.g. Punjabi) STT/TTS. The app degrades gracefully.
