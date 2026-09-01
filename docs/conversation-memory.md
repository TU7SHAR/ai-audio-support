# Conversation Memory & Session Management

> Status: **basic and functional, but not optimized.** This doc records exactly
> how memory works today, the gaps, and the prioritized plan to improve it.

## How it works today

Memory is **entirely client-side and unbounded on the prompt**:

1. `app/page.js` keeps `messages` in React state, persisted to `localStorage`
   (capped at the **last 100 messages** — a UI cap, not a prompt cap).
2. On each send, it builds `history` from **all** current messages and passes it
   to `streamChat`.
3. `lib/api.js` puts the full `history` array in the request body.
4. Backend `main.py` accepts it and forwards it verbatim to
   `ollama_client._build_messages`, which replays **every** turn into the Ollama
   prompt.

So there *is* memory — and it survives a page refresh — but there are **no
sessions**, **no server-side memory**, and **no context-window management**.

## Gaps (in priority order)

### 1. No token / context-window management  ← highest impact
The backend replays the *entire* history every turn. On a CPU-only box with
`qwen2.5:3b`'s limited context window this means:
- Latency climbs turn-over-turn (worse time-to-first-token).
- Eventually the context window overflows and Ollama **silently truncates from
  the front** — the model forgets the system prompt and earliest turns
  unpredictably.
- The 100-message localStorage cap would blow the window long before it's hit.

### 2. No real session identity
Memory lives only in one browser's localStorage. Different device = amnesia.
No `session_id`, no server-side resume, no multiple independent conversations,
no transcripts for handoff/analytics.

### 3. No summarization / trimming strategy
The standard fix — keep the last N turns verbatim + a rolling summary of older
turns — isn't present. It's all-or-nothing today.

### 4. History is trusted blindly
The backend injects arbitrary client-supplied `history` straight into the
prompt. A client can forge "assistant" turns to steer the model (prompt
injection via forged history). Fine for a prototype, risky for real support.

### 5. No per-turn cost controls
No server-side cap on history length or on individual message size.

## Verdict

For a **working prototype it's acceptable** — memory functions and survives
refresh. As **"optimized session management" the piece is essentially missing.**
The critical gap is #1 (server-side context management); the rest are maturity
steps beyond it.

## Improvement plan

| # | Change | Impact | Effort | Where |
|---|--------|--------|--------|-------|
| 1 | **Bounded history** — cap replayed turns to last N and/or a token/char budget, always keeping the system prompt | High (fixes latency growth + silent truncation) | Low (~20 lines) | `config.py`, `ollama_client.py` |
| 2 | **Rolling summarization** — summarize older turns into one compact note, keep recent turns verbatim | High (best memory-vs-cost tradeoff) | Medium | `ollama_client.py` (+ a summarize call) |
| 3 | **Real sessions** — `session_id` + server-side store (in-memory/SQLite); client sends the id | Medium (resume, multi-device, transcripts) | Medium–High | new module + `main.py` |
| 4 | **Validate/limit incoming history** — length caps, drop empty/oversized turns | Medium (safety) | Low | `main.py` |

**Recommended start:** #1. It's the change that most directly improves the live
system's speed and reliability, and it's small and safe. Then #2 for quality,
#3 for real product features, #4 alongside for hardening.

### Sketch for #1 (bounded history)
- Add `MAX_HISTORY_TURNS` (e.g. 8) and optionally `MAX_HISTORY_CHARS` to
  `config.py`.
- In `_build_messages`, after the system prompt, keep only the last
  `MAX_HISTORY_TURNS` turns (or trim oldest until under the char/token budget).
- Never drop the system prompt; drop from the **oldest** history first.

## Related decisions
See [`decisions.md`](./decisions.md) — ADR on statelessness and the memory
approach.
