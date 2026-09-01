# Frontend

A **Next.js** (App Router) app that provides the voice-first chat UI. Deployed to
**Vercel**. The primary interaction is the microphone; a text input is the
secondary path.

```
Browser (this app) ──POST /chat/stream──▶ Backend API ──▶ Ollama + Qwen
```

## File map (`frontend/`)

| File | Responsibility |
|------|----------------|
| `app/page.js` | The whole UI: chat bubbles, mic control, sentence-sync queue, settings, persistence |
| `lib/api.js` | Fetch helpers: `sendChat`, `streamChat`, `getHealth`; reads `NEXT_PUBLIC_API_BASE_URL` |
| `lib/useSpeech.js` | Voice engine: `SpeechRecognition` (STT) + `speechSynthesis` (TTS) |
| `app/layout.js`, `app/globals.css` | Shell + styles (Tailwind v4) |

## The voice engine (`lib/useSpeech.js`)

Wraps the browser's **Web Speech API** — no libraries, no server work, free.

- **STT:** `SpeechRecognition` with `interimResults` (live words) and
  `continuous:false` (auto-stops after a pause). Language set from the picker.
- **TTS:** `speechSynthesis`; picks the best installed voice for the chosen
  language, falling back to English then any available voice.
- **`primeSpeech()`:** mobile browsers require a real user tap to "unlock" audio.
  This fires a silent utterance on the mic tap so later `speak()` calls produce
  sound. **Critical for mobile.**
- **Graceful degradation:** if a language's STT engine / TTS voice isn't
  installed on the device, it falls back rather than breaking.

## The sentence-sync UI (`app/page.js`) — the clever bit

As reply chunks stream in, the UI:

1. Accumulates text and slices off **completed sentences** (`.!?`).
2. Pushes each sentence into a **speech queue**.
3. For each queued sentence: speaks it aloud **and** reveals its text
   word-by-word (`streamWords`) timed to roughly match the speech duration, so
   on-screen text flows in sync with the voice.
4. A `Stop` button aborts the in-flight fetch (`AbortController`) and cancels
   speech immediately.

## State & settings

- **Messages** live in React state, persisted to `localStorage`
  (`aas.conversation.v1`), capped at the **last 100 messages**.
- **Settings** (voice on/off, language, web-search) persisted in
  `aas.settings.v1`.
- **History** for each request is built from current messages and sent to the
  backend, which replays it into the prompt. See
  [`conversation-memory.md`](./conversation-memory.md).

## Languages

The picker offers `auto` + a set of BCP-47 tags (English, Hindi, Punjabi,
Bengali, Tamil, Telugu, Marathi, Gujarati, Spanish, French). `code` drives the
mic/voice; `apiLang` (short code) is sent to the backend to steer the reply
language.

## Environment

| Variable | Example | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<tunnel>.trycloudflare.com` | Public backend URL. **Must** keep `NEXT_PUBLIC_` prefix (read in browser) and be **HTTPS**. |

## Deploying to Vercel

1. Import the repo.
2. Set **Root Directory** = `frontend` (monorepo).
3. Add `NEXT_PUBLIC_API_BASE_URL` = backend's public HTTPS URL.
4. Deploy.

> **Mixed-content note:** Vercel serves HTTPS; a plain `http://` API URL will be
> blocked by the browser. The UI detects this and shows a warning. Use HTTPS.

## Known gaps / notes

- The "searching the web…" indicator reflects the **toggle**, not whether the
  backend actually ran a search (the stream endpoint doesn't report it).
- Memory is browser-local only — no cross-device or server-side sessions yet.
