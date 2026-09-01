# Frontend Commands

Next.js (App Router) app in `frontend/`, deployed to Vercel.

## Set up & run locally

```bash
cd frontend
npm install
cp .env.example .env.local    # set NEXT_PUBLIC_API_BASE_URL
npm run dev
```

Open http://localhost:3000.

| Command | What it does | Affects |
|---------|--------------|---------|
| `npm install` | Installs deps from `package.json` | `frontend/node_modules/` (gitignored) |
| `npm run dev` | Starts the Next.js dev server on :3000 (hot reload) | local dev only |
| `npm run build` | Production build — **use this to verify the app compiles** | `.next/` build output |
| `npm run start` | Serves the production build locally | local only |
| `npm run lint` | Runs ESLint | reports issues, no file changes |

> ⚠️ `npm run dev`/`start` are long-lived servers — don't run them in an
> automated/CI shell (they block). Use `npm run build` to verify compilation.

## Environment variable

| Variable | Example | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<tunnel>.trycloudflare.com` | Public backend URL. **Must** keep the `NEXT_PUBLIC_` prefix (read in browser) and be **HTTPS** (mixed-content otherwise). |

- **Local:** set in `frontend/.env.local`.
- **Vercel:** Project Settings → Environment Variables. Changing it triggers a
  redeploy — relevant because temporary tunnel URLs rotate on restart.

## Deploy to Vercel

1. Import the repo in Vercel.
2. **Root Directory = `frontend`** (this is a monorepo).
3. Add `NEXT_PUBLIC_API_BASE_URL` = backend's public **HTTPS** URL.
4. Deploy.

## What the key files do (frontend)

| File | Role |
|------|------|
| `app/page.js` | The whole UI: chat, mic control, sentence-sync speech queue, settings, persistence |
| `lib/api.js` | `sendChat`, `streamChat`, `getHealth`; reads `NEXT_PUBLIC_API_BASE_URL` |
| `lib/useSpeech.js` | Voice engine: `SpeechRecognition` (STT) + `speechSynthesis` (TTS), `primeSpeech()` for mobile |
| `app/layout.js`, `app/globals.css` | Shell + Tailwind v4 styles |

> Browser support: mic/voice is solid in Chrome/Edge; non-English STT/TTS depends
> on the device having that engine/voice installed.
