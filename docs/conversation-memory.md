# Conversation Memory & Session Management

> Status: **bounded history implemented (plan #1 done); summarization + real
> sessions still pending.** This doc records how memory works, the gaps, and the
> prioritized plan to improve it.

## ✅ Implemented: server-side bounded history (plan #1)

The backend no longer replays the *entire* history into the prompt. In
`ollama_client._trim_history` it now:
1. drops empty/invalid turns,
2. keeps only the last `MAX_HISTORY_TURNS` turns (default **12**),
3. then trims from the **oldest** kept turn until total characters are under
   `MAX_HISTORY_CHARS` (default **6000**).

The **system prompt is always preserved** (added separately, never trimmed).
Both limits are configurable in `.env`; setting either to `0` disables it.
This fixes the latency-growth and silent-truncation risks below. See the
[backend config](./backend.md#configuration-env-see-envexample).

## How it works today

Memory is still **held by the client** (localStorage) and sent on every request,
but the **prompt is now bounded server-side**:

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

### 1. ~~No token / context-window management~~ ✅ DONE
Previously the backend replayed the *entire* history every turn, which grew
latency and risked silent context-window truncation. **Now bounded** via
`MAX_HISTORY_TURNS` + `MAX_HISTORY_CHARS` (see the Implemented section above).

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

The **critical gap (#1, context-window management) is now fixed.** Memory
functions, survives refresh, and the prompt is bounded and predictable. The
remaining items (real sessions, summarization, validation) are maturity steps.

## Improvement plan

| # | Change | Impact | Effort | Where | Status |
|---|--------|--------|--------|-------|--------|
| 1 | **Bounded history** — cap replayed turns and/or char budget, always keep system prompt | High (fixes latency growth + silent truncation) | Low | `config.py`, `ollama_client.py` | ✅ done |
| 2 | **Rolling summarization** — summarize older turns into one compact note, keep recent turns verbatim | High (best memory-vs-cost tradeoff) | Medium | `ollama_client.py` (+ a summarize call) | ⏳ next |
| 3 | **Real sessions** — `session_id` + server-side store (in-memory/SQLite); client sends the id | Medium (resume, multi-device, transcripts) | Medium–High | new module + `main.py` | ⏳ |
| 4 | **Validate/limit incoming history** — length caps, drop empty/oversized turns | Medium (safety) | Low | `main.py` | ⏳ (partly covered: `_trim_history` already drops empty/invalid turns) |

**Recommended next:** #2 (summarization) for answer quality on longer chats,
then #3 for real product features.

## Related decisions
See [`decisions.md`](./decisions.md) — ADR on statelessness and the memory
approach.
