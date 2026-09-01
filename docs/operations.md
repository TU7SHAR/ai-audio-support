# Operations

How to run, deploy, and operate the system — plus the gotchas that bite most.

## Run locally

**1. Backend** (needs Ollama + a pulled model):

```bash
ollama pull qwen2.5:3b
ollama list                      # confirm it's there

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # edit if needed
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**2. Frontend** (another terminal):

```bash
cd frontend
npm install
cp .env.example .env.local       # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000.

## Quick backend checks

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you help me with?"}'
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Give me a short greeting"}'
```

## Run the backend as a service (Oracle server)

```bash
sudo cp deploy/ai-support-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-support-api
systemctl status ai-support-api
journalctl -u ai-support-api -f   # live logs
```

Edit the unit file if your user/paths differ from `ubuntu` /
`/home/ubuntu/ai-audio-support/backend`.

## Exposing the backend to the frontend

The Vercel frontend must reach the API over the internet, **over HTTPS**.

- **Tunnel (quick / current):** a tool like Cloudflare Tunnel gives a temporary
  HTTPS URL. Downside: the URL **changes on restart** — you must update
  `NEXT_PUBLIC_API_BASE_URL` on Vercel each time (which triggers a redeploy).
- **Domain + reverse proxy (recommended):** Caddy/Nginx with HTTPS in front of
  the API. Stable URL, fixes mixed content permanently, no redeploy churn.

Set `CORS_ORIGINS` in `.env` to your Vercel URL once deployed, e.g.
`CORS_ORIGINS=https://your-app.vercel.app`.

## Deploy the frontend (Vercel)

1. Import the repo.
2. **Root Directory = `frontend`** (monorepo).
3. Add `NEXT_PUBLIC_API_BASE_URL` = backend's public HTTPS URL.
4. Deploy.

## Gotchas (most common → least)

1. **Mixed content.** HTTPS Vercel page + `http://` API = browser blocks every
   request. The API URL **must be HTTPS**. The UI warns when it detects this.
2. **Tunnel URL rotated.** If chat suddenly fails after a restart, the tunnel
   URL changed — update `NEXT_PUBLIC_API_BASE_URL` on Vercel.
3. **CORS.** If the browser reports a CORS error, set `CORS_ORIGINS` to the exact
   Vercel origin (or `*` for testing).
4. **Model not loaded.** `/health` reports `model_present: false` → run
   `ollama pull qwen2.5:3b` on the server.
5. **Slow first token.** CPU-only inference; expected. Streaming is what makes it
   feel responsive — don't switch the UI to the non-streaming `/chat`.
6. **Mic/voice not working.** Use Chrome/Edge; non-English STT/TTS depends on the
   device having that engine/voice installed.

## Configuration reference

Backend `.env` — see [`backend.md`](./backend.md#configuration-env-see-envexample).
Frontend env — see [`frontend.md`](./frontend.md#environment).
