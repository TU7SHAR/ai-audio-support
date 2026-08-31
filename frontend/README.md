# Frontend — AI Audio Support

A [Next.js](https://nextjs.org) (App Router) app that provides the chat UI and
will host the voice (microphone + speech) experience. Deploys to
[Vercel](https://vercel.com).

```
Browser (this app)  ──POST /chat──▶  Backend API  ──▶  Ollama + Qwen
```

## Local development

```bash
cd frontend
npm install
cp .env.example .env.local     # point NEXT_PUBLIC_API_BASE_URL at your backend
npm run dev
```

Open http://localhost:3000. Make sure the backend is running (see
`../backend/README.md`) and reachable at the URL in `.env.local`.

## Environment variables

| Variable                   | Example                     | Notes                                 |
|----------------------------|-----------------------------|---------------------------------------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000`     | Public URL of the backend API         |

On Vercel, set this in **Project Settings → Environment Variables**. Because it
is read in the browser, it **must** keep the `NEXT_PUBLIC_` prefix.

## Deploying to Vercel

1. Import this repo in Vercel.
2. Set the **Root Directory** to `frontend` (this is a monorepo).
3. Add the `NEXT_PUBLIC_API_BASE_URL` env var pointing to your server's public
   API URL.
4. Deploy.

> **HTTPS note:** Vercel serves your site over HTTPS. Browsers block calls from
> an HTTPS page to a plain `http://` API ("mixed content"). Give your backend an
> HTTPS URL (domain + reverse proxy) before the deployed site can reach it.

## What's here

- `app/page.js` — the chat UI (a Client Component). Streams replies from the
  backend and renders them live. Voice input/output will be added here.
- `lib/api.js` — helper functions for calling the backend (`sendChat`,
  `streamChat`, `getHealth`).
