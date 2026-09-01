# 📚 Documentation Index

This folder is the **single source of truth** for how AI Audio Support is built,
why it's built that way, and what's still open. It exists so that anyone (human
or AI assistant) can get up to speed quickly and recall project context without
re-reading the entire codebase.

> Keep these docs updated as the system evolves. When you make a meaningful
> architectural or product decision, record it in [`decisions.md`](./decisions.md).

## Contents

| Doc | What it covers |
|-----|----------------|
| [`overview.md`](./overview.md) | What the product is, the end-to-end flow, current status |
| [`architecture.md`](./architecture.md) | System design, the two phases, data flow, deployment |
| [`backend.md`](./backend.md) | FastAPI service, endpoints, config, files, tests |
| [`frontend.md`](./frontend.md) | Next.js app, voice engine, sentence-sync UI, state |
| [`conversation-memory.md`](./conversation-memory.md) | How memory works today, gaps, and the improvement plan |
| [`roadmap.md`](./roadmap.md) | Milestones, what's done, what's next |
| [`decisions.md`](./decisions.md) | Architecture Decision Records (ADRs) — the "why" behind choices |
| [`operations.md`](./operations.md) | Running, deploying, tunnels, common gotchas |

## Quick facts

- **Product:** real-time AI voice customer-support agent (speak → answer in voice).
- **Model:** self-hosted [Qwen2.5:3b](https://ollama.com/library/qwen2.5) via [Ollama](https://ollama.com), CPU-only.
- **Backend:** FastAPI, deployed on an Oracle Cloud free ARM instance.
- **Frontend:** Next.js (App Router), deployed on Vercel.
- **Connection:** temporary HTTPS **tunnel** links bridge Vercel → Oracle backend.
- **Status:** live and working; core voice loop + streaming + multi-language + optional web search all functional.
