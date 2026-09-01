# 🤖 Agent Activity Log

A running record of every change an AI agent makes to this project. **Append a
new entry (newest at top) on every change.** Never rewrite history — only add.

Each entry captures:
- **Asked** — what the user requested.
- **Interpreted** — how the agent understood the request.
- **Did** — the concrete actions taken.
- **Files affected** — what changed.
- **Impact** — the effect / what it enables or fixes.
- **PR** — the pull request for the change (each change = a new PR).

---

## 2026-09-01 — Server-side bounded conversation history (memory plan #1)

- **Asked:** Implement the conversation-memory plan. Also: always open a new PR
  per change (never re-edit an existing one); keep the docs md files updated;
  add a `commands/` folder documenting what commands/files do; and add an agent
  activity log tracking what the agent did / changed / affected and what it was
  asked vs. how it interpreted it — updated on every change.
- **Interpreted:** Ship item #1 of the memory plan (bounded history) as the
  first, highest-impact step — cap the history replayed into the Ollama prompt
  server-side while always keeping the system prompt. Set up the requested
  living-documentation system (`commands/` folder + this log) and update docs.
  Do it all on a brand-new branch and open a fresh PR.
- **Did:**
  - Created branch `feat/bounded-conversation-history` off `main` (did not reuse
    the `docs/project-documentation` branch from PR #9).
  - Added `max_history_turns` (12) and `max_history_chars` (6000) to
    `backend/app/config.py`, documented in `backend/.env.example`.
  - Added `_trim_history()` in `backend/app/ollama_client.py`: drops
    empty/invalid turns, keeps the last N turns, then trims oldest-first to fit
    the char budget; wired it into `_build_messages` so the **system prompt is
    always preserved**.
  - Added 5 tests in `backend/tests/test_api.py` (turn cap, char budget,
    system-prompt preservation, bounded history reaching Ollama). All 13 tests
    pass (Python 3.11; note: sandbox default `python3` is 3.9 and fails on
    `str | None` — must use 3.10+).
  - Created the `commands/` folder (index + backend/frontend/git-deploy/file
    references).
  - Created this activity log and updated `docs/` (conversation-memory, backend,
    roadmap, decisions, index).
- **Files affected:** `backend/app/config.py`, `backend/app/ollama_client.py`,
  `backend/.env.example`, `backend/tests/test_api.py`, `commands/*` (new),
  `docs/agent-activity-log.md` (new), `docs/conversation-memory.md`,
  `docs/backend.md`, `docs/roadmap.md`, `docs/decisions.md`, `docs/README.md`.
- **Impact:** Conversation length no longer grows the prompt without bound —
  stabilizes per-turn latency on the CPU-only box and prevents silent
  context-window truncation of the system prompt/earliest turns. This is memory
  plan step #1; summarization (#2), real sessions (#3), and history validation
  (#4) remain.
- **PR:** #10 — https://github.com/TU7SHAR/ai-audio-support/pull/10

---

## 2026-09-01 — Project documentation (`docs/` folder)

- **Asked:** Create markdown files in the repo, in a dedicated folder, for easier
  tracking and memory recall.
- **Interpreted:** Add a `docs/` folder as a single source of truth: overview,
  architecture, per-service details, the conversation-memory analysis, roadmap,
  and decision records — cross-linked and easy to update.
- **Did:** Created `docs/README.md`, `overview.md`, `architecture.md`,
  `backend.md`, `frontend.md`, `conversation-memory.md`, `roadmap.md`,
  `operations.md`, `decisions.md`; linked `docs/` from the root README.
- **Files affected:** `docs/*` (new), `README.md`.
- **Impact:** Project context is now persisted and navigable without re-reading
  the whole codebase.
- **PR:** #9 — https://github.com/TU7SHAR/ai-audio-support/pull/9
