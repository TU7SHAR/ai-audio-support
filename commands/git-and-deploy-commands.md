# Git, PR & Deploy Commands

## PR workflow (STRICT rule for this repo)

> **Every fix or iteration gets its own fresh branch and its own NEW PR.**
> Never re-edit, amend, or re-push to an existing/opened PR. Never reuse a
> merged/closed branch.

```bash
# Always branch off up-to-date main
git checkout main
git pull
git checkout -b <type>/<short-topic>     # e.g. feat/bounded-conversation-history

# ... make changes, then ...
git add <specific files>
git commit -m "<type>: <summary>"
git push -u origin <branch>
```

Open the PR via the GitHub REST API (the `gh pr`/`gh issue` subcommands don't
work in this environment):

```bash
gh api repos/<owner>/<repo>/pulls \
  -f title="<title>" \
  -f head="<branch>" \
  -f base="main" \
  -f body="<body>" \
  --jq '{url: .html_url, number: .number}'
```

| Command | What it does |
|---------|--------------|
| `git checkout -b <branch>` | Creates a new branch for the change |
| `git push -u origin <branch>` | Publishes the branch and sets upstream |
| `gh api .../pulls -f ...` | Opens a **new** PR from the branch into `main` |
| `gh api "repos/<owner>/<repo>/pulls?state=all"` | Lists PRs (check before pushing) |

## Branch naming convention

`feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…` + a short dashed topic.

## Backend deploy (Oracle server, systemd)

```bash
sudo cp deploy/ai-support-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-support-api
systemctl status ai-support-api
journalctl -u ai-support-api -f
```

| Command | What it does |
|---------|--------------|
| `systemctl enable --now ai-support-api` | Starts the API now + on boot |
| `systemctl status ai-support-api` | Shows service state |
| `journalctl -u ai-support-api -f` | Tails live logs |

The unit waits for `ollama.service` and restarts on failure. Edit paths/user in
the unit file if they differ from `ubuntu` / `/home/ubuntu/...`.

## Exposing the backend (tunnel vs. proxy)

- **Tunnel (temporary):** gives an HTTPS URL that **changes on restart** — you
  must update `NEXT_PUBLIC_API_BASE_URL` on Vercel each time.
- **Domain + reverse proxy (Caddy/Nginx, recommended):** stable HTTPS URL, fixes
  mixed content permanently, no redeploy churn.

Set `CORS_ORIGINS` in backend `.env` to the Vercel origin once deployed.
