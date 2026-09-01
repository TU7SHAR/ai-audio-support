# Architecture Decision Records (ADRs)

Short records of *why* key choices were made, so we don't relitigate them and so
future readers (human or AI) understand the reasoning. Add a new entry when you
make a meaningful decision.

---

## ADR-001 — Self-hosted Qwen via Ollama (not a hosted LLM API)
**Decision:** run `qwen2.5:3b` on our own server through Ollama.
**Why:** no per-request/token cost; full control; privacy of the model host.
**Trade-off:** CPU-only Oracle free tier is slow → we lean on streaming for
perceived speed and keep the model small (3b is the sweet spot on CPU).

## ADR-002 — FastAPI service in front of Ollama (never expose Ollama)
**Decision:** a public FastAPI service is the only internet-facing component;
Ollama stays bound to `127.0.0.1`.
**Why:** Ollama has no auth and shouldn't be public. The API is where we own
prompts, CORS, language handling, web-search retrieval, and (later) auth, rate
limits, and sessions.

## ADR-003 — Browser Web Speech API for STT + TTS
**Decision:** do speech-to-text and text-to-speech in the browser, not on the
server.
**Why:** free, zero server load, no audio services to integrate.
**Trade-off:** support is best in Chrome/Edge and varies for non-English
(esp. Punjabi). We degrade gracefully rather than break.

## ADR-004 — Streaming-first (`/chat/stream`)
**Decision:** the primary path streams the reply token/chunk by chunk; the UI
speaks and reveals text sentence-by-sentence.
**Why:** on a CPU box, full answers take seconds; streaming is what makes it feel
like a real-time call. The API and UI are built around it.

## ADR-005 — Monorepo, two independently deployable halves
**Decision:** `frontend/` (Vercel) and `backend/` (Oracle) in one repo.
**Why:** shared history/context, but separate deploy targets and lifecycles.
Vercel uses Root Directory = `frontend`.

## ADR-006 — Stateless backend; memory held by the client (CURRENT, under review)
**Decision (so far):** the backend keeps no session state. The browser stores the
conversation in `localStorage` and sends the full `history` on every request,
which the backend replays into the prompt.
**Why it was fine to start:** simplest possible thing; no session store to build;
memory survives refresh.
**Why it's under review:** replaying full history doesn't scale on a small model /
CPU box (latency growth, silent context-window truncation), there are no real
sessions (no multi-device/resume), and client-supplied history is trusted
blindly. See [`conversation-memory.md`](./conversation-memory.md) for the plan to
add bounded history → summarization → real sessions.
**Status:** 🔄 in progress. Step 1 done — server-side **bounded history**
(`MAX_HISTORY_TURNS` + `MAX_HISTORY_CHARS`, system prompt always kept). Sessions
and summarization still pending.

## ADR-008 — Bound replayed history server-side (not client-side)
**Decision:** the backend caps how much history it replays into the prompt
(`_trim_history`: turn cap, then char budget, oldest dropped first), rather than
relying on the client to limit it.
**Why:** the client can't be trusted to protect the model's context window, and
the backend owns prompt construction. Keeping it server-side guarantees the
system prompt survives and latency stays bounded regardless of client behaviour.
**Trade-off:** older turns fall out of context (mitigated later by summarization,
plan #2). Limits are configurable; `0` disables them.

## ADR-007 — Optional web search via Brave Search API
**Decision:** when `web_search` is on and a `BRAVE_API_KEY` is set, fetch live
results and inject them into the prompt as context ("retrieval").
**Why:** the model can't browse; this lets it answer from real, current data.
**Trade-off:** adds latency before the first token; silently skipped without a
key so the app still works.
