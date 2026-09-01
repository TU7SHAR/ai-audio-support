# 🛠️ Commands & File Reference

This folder is a **quick-reference for every command you run and every file that
matters** in this project — what it does, when to use it, and what it affects.
It exists so anyone (human or AI) can act without re-deriving how things work.

> **Keep this updated on every change.** When a command, script, config, or
> important file is added/changed/removed, update the matching file here.

## Contents

| File | Covers |
|------|--------|
| [`backend-commands.md`](./backend-commands.md) | Running, testing, and serving the FastAPI backend + Ollama |
| [`frontend-commands.md`](./frontend-commands.md) | Running, building, and deploying the Next.js frontend |
| [`git-and-deploy-commands.md`](./git-and-deploy-commands.md) | Branching, PR workflow, tunnels, systemd deploy |
| [`file-reference.md`](./file-reference.md) | What each source/config file in the repo does |

## Golden rules for this repo

- **Python:** the code uses `str | None` syntax → needs **Python ≥ 3.10**.
  The sandbox default `python3` is 3.9 and will fail; use 3.11.
- **New PR per change:** every fix/iteration gets a **fresh branch and a new
  PR**. Never re-edit or re-push to an existing PR.
- **Keep docs alive:** update [`docs/`](../docs/README.md), this `commands/`
  folder, and the [agent activity log](../docs/agent-activity-log.md) with every
  change.
