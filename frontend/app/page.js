"use client";

// The main chat page.
//
// This must be a Client Component ("use client") because it uses React state,
// event handlers, and (later) browser-only APIs like the microphone. Server
// Components can't do those.
//
// Step 1 (now): a text chat that talks to the backend /chat API.
// Step 4 (later): add mic input (speech-to-text) and spoken replies
// (text-to-speech) around this same logic.

import { useEffect, useRef, useState } from "react";
import { streamChat, getHealth } from "@/lib/api";

export default function Home() {
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  // Check backend health on load so the user immediately knows if the
  // server/model isn't reachable.
  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e) => setError(`Can't reach backend: ${e.message}`));
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setError("");
    setInput("");
    setBusy(true);

    // Add the user's message and an empty assistant message we'll fill as the
    // reply streams in.
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    try {
      await streamChat(text, history, (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      });
    } catch (err) {
      setError(err.message);
      setMessages((prev) => {
        const next = [...prev];
        // Replace the empty assistant bubble with an error note.
        if (next.length && next[next.length - 1].role === "assistant" && !next[next.length - 1].content) {
          next[next.length - 1] = {
            role: "assistant",
            content: "⚠️ Sorry, I couldn't get a response. Check the backend connection.",
          };
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  const modelReady = health?.ollama?.model_present;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            AI Audio Support
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Text chat prototype — voice coming next.
          </p>
          <StatusBadge health={health} error={error} />
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-zinc-950"
        >
          {messages.length === 0 && (
            <p className="mt-8 text-center text-sm text-zinc-400">
              Say hello 👋 — try &ldquo;What can you help me with?&rdquo;
            </p>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={modelReady === false ? "Model not loaded on server…" : "Type a message…"}
            className="flex-1 rounded-full border border-black/[.12] bg-white px-4 py-3 text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:bg-zinc-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-black px-6 py-3 font-medium text-white transition-opacity disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-black text-white dark:bg-white dark:text-black"
            : "bg-zinc-100 text-black dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {content || <span className="opacity-40">…</span>}
      </div>
    </div>
  );
}

function StatusBadge({ health, error }) {
  if (error) {
    return <p className="mt-2 text-xs text-red-500">● {error}</p>;
  }
  if (!health) {
    return <p className="mt-2 text-xs text-zinc-400">● Connecting to backend…</p>;
  }
  const ok = health?.ollama?.model_present;
  return (
    <p className={`mt-2 text-xs ${ok ? "text-green-600" : "text-amber-500"}`}>
      ● {ok ? `Ready — model: ${health.model}` : "Backend up, but model not loaded"}
    </p>
  );
}
