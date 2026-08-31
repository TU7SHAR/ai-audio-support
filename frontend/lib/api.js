// Small helper for talking to the backend API.
//
// The backend base URL comes from an environment variable so the same code
// works locally and on Vercel:
//   - Local dev: create `frontend/.env.local` with
//       NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
//   - Vercel: set NEXT_PUBLIC_API_BASE_URL in Project Settings → Environment
//     Variables to your server's public URL (e.g. https://api.yourdomain.com)
//
// NEXT_PUBLIC_ prefix is required so the value is available in the browser.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/**
 * Send a message and get the full reply back (waits for completion).
 * @param {string} message
 * @param {Array<{role: string, content: string}>} history
 * @param {{ language?: string, webSearch?: boolean }} [opts]
 * @returns {Promise<string>} the assistant's reply text
 */
export async function sendChat(message, history = [], opts = {}) {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      language: opts.language || null,
      web_search: !!opts.webSearch,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  return data.reply;
}

/**
 * Stream a reply, calling onChunk for each piece of text as it arrives.
 * @param {string} message
 * @param {Array<{role: string, content: string}>} history
 * @param {(chunk: string) => void} onChunk
 * @param {{ language?: string, webSearch?: boolean }} [opts]
 * @returns {Promise<string>} the full reply once complete
 */
export async function streamChat(message, history = [], onChunk, opts = {}) {
  const res = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      language: opts.language || null,
      web_search: !!opts.webSearch,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${detail || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    if (onChunk) onChunk(chunk);
  }
  return full;
}

/** Check backend + model health. */
export async function getHealth() {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
