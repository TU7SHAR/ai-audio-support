# Backend — AI Audio Support API

A small FastAPI service that sits in front of your local **Ollama + Qwen** model.
The browser frontend sends transcribed text here; this service asks Qwen and
returns the reply.

```
Browser  ──HTTP──▶  This API (port 8000, public)  ──▶  Ollama (localhost:11434)  ──▶  Qwen
```

> **Why a service in front of Ollama?** Ollama listens on `127.0.0.1` only and
> should never be exposed to the internet directly. This API is the safe, public
> front door where we control prompts, CORS, and (later) auth and rate limits.

---

## Endpoints

| Method | Path           | What it does                                             |
|--------|----------------|----------------------------------------------------------|
| GET    | `/health`      | Reports API status + whether Ollama and the model are up |
| POST   | `/chat`        | Send `{message}`, get the full `{reply}` back            |
| POST   | `/chat/stream` | Same input, but streams the reply text chunk-by-chunk    |

Request body for `/chat` and `/chat/stream`:

```json
{
  "message": "Hi, I need help with my order",
  "history": [
    { "role": "user", "content": "earlier message" },
    { "role": "assistant", "content": "earlier reply" }
  ]
}
```

`history` is optional — send it to give the model conversation context.

---

## Run locally (or on the Oracle server)

You need Ollama already installed and the model pulled:

```bash
ollama pull qwen2.5:3b
ollama list          # confirm it's there
```

Then start the API:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # edit if needed
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Test it:

```bash
# health check
curl http://localhost:8000/health

# a chat message
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you help me with?"}'

# streaming
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Give me a short greeting"}'
```

---

## Run as a service (recommended on the server)

So the API restarts on crash/reboot:

```bash
sudo cp deploy/ai-support-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-support-api
systemctl status ai-support-api
journalctl -u ai-support-api -f     # live logs
```

Edit the unit file first if your paths/user differ from `ubuntu` /
`/home/ubuntu/ai-audio-support/backend`.

---

## Exposing the API to your frontend

Your Vercel frontend needs to reach this API over the internet. Options:

1. **Open the port on Oracle Cloud** (quick, for prototyping): allow inbound
   TCP `8000` in the VCN security list / NSG, and confirm the OS firewall
   allows it. Then your API is at `http://<server-ip>:8000`.
2. **Put a reverse proxy (Caddy/Nginx) with HTTPS in front** (recommended
   before real use): browsers on an HTTPS site (Vercel) will block calls to a
   plain `http://` API (mixed content). A domain + HTTPS fixes this.

Set `CORS_ORIGINS` in `.env` to your Vercel URL once you deploy, e.g.
`CORS_ORIGINS=https://your-app.vercel.app`.

---

## Configuration

All settings live in `.env` (see `.env.example`):

| Var               | Default                    | Notes                                  |
|-------------------|----------------------------|----------------------------------------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434`   | Where Ollama listens                   |
| `OLLAMA_MODEL`    | `qwen2.5:3b`               | Must match a model from `ollama list`  |
| `OLLAMA_TIMEOUT`  | `120`                      | Seconds; CPU inference can be slow      |
| `TEMPERATURE`     | `0.4`                      | Lower = more focused answers           |
| `CORS_ORIGINS`    | `*`                        | Comma-separated allowed browser origins |
