# Roadmap

## Done ✅

- **Step 1** — Backend `/chat` API backed by Ollama/Qwen + basic chat UI.
- **Step 2** — Streaming replies wired into the UI (`/chat/stream`).
- **Step 3** — Microphone input (browser speech-to-text).
- **Step 4** — Spoken replies (browser text-to-speech) + Stop/interrupt.
- **Multi-language** — reply language + mic/voice language picker.
- **Live web search** — optional Brave Search grounding.
- **UX polish** — Stop/Clear/Copy, persistence, timestamps, thinking/answering
  indicators, mixed-content warning.

## Next 🔜 (prioritized)

### 1. Conversation memory / session management  ← in progress
See [`conversation-memory.md`](./conversation-memory.md) for the full plan.
- [x] **Bounded history** (cap replayed turns + char budget, keep system prompt) — done.
- [ ] **Rolling summarization** of older turns.  ← next
- [ ] **Real server-side sessions** (`session_id` + store).
- [ ] **Validate/limit incoming history** (safety) — partly covered by `_trim_history`.

### 2. Stream endpoint parity
- [ ] Have `/chat/stream` signal whether web search was actually used, so the UI
      indicator reflects reality (not just the toggle).

### 3. Support knowledge base / FAQ grounding
- [ ] Ground answers in a curated KB/FAQ (retrieval over your own docs), not just
      the web.

### 4. Hardening for real use
- [ ] Lock down `CORS_ORIGINS` to the Vercel URL.
- [ ] Add auth / rate limiting on the public API.
- [ ] Stable HTTPS endpoint (domain + reverse proxy) instead of a temporary
      tunnel. See [`operations.md`](./operations.md).

## Nice-to-have / later

- [ ] Analytics + transcript export for conversations.
- [ ] Agent handoff (human takeover) flow.
- [ ] Better non-English voice support / fallback messaging.
- [ ] Frontend `.env.example` (referenced by the frontend README but not present).
