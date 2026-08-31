"use client";

// AI Audio Support — voice-first chat page.
//
// Primary interaction is the microphone: the user taps it, speaks, their words
// appear live in a chat bubble, and the assistant's reply is BOTH streamed into
// a bubble AND spoken aloud. A text input is kept as a secondary option.
//
// Voice uses the browser's built-in Web Speech API (see lib/useSpeech.js) — no
// extra services and no backend changes.

import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat, getHealth } from "@/lib/api";
import { useSpeech } from "@/lib/useSpeech";

// Break a block of text into sentence-sized chunks for the synced queue.
// Splits after . ! ? (keeping the punctuation). Any trailing text without
// ending punctuation comes back as its own chunk.
function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

export default function Home() {
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [voiceReplies, setVoiceReplies] = useState(true); // speak answers aloud
  const scrollRef = useRef(null);

  // Holds the latest hook fns so submitMessage can use them without depending
  // on hook declaration order.
  const speakRef = useRef(() => {});
  const voiceRepliesRef = useRef(voiceReplies);
  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
  }, [voiceReplies]);

  // Append text to the current (last) assistant bubble.
  const appendToAssistant = useCallback((text) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { role: "assistant", content: last.content + text };
      return next;
    });
  }, []);

  // --- Core send logic (shared by mic and text) --------------------------
  const submitMessage = useCallback(
    async (rawText) => {
      const text = (rawText || "").trim();
      if (!text || busy) return;

      setError("");
      setInput("");
      setBusy(true);

      // Snapshot history BEFORE adding the new turn.
      let history;
      setMessages((prev) => {
        history = prev.map((m) => ({ role: m.role, content: m.content }));
        return [
          ...prev,
          { role: "user", content: text },
          { role: "assistant", content: "" },
        ];
      });

      const speakOn = voiceRepliesRef.current;

      // A queue of sentences waiting to be spoken + revealed in sync.
      const queue = [];
      let queueRunning = false;
      let streamDone = false;
      let sentenceIndex = 0;
      let resolveWhenDone;
      const allSpoken = new Promise((res) => (resolveWhenDone = res));

      // Reveal a sentence's text in the bubble at the same moment we speak it,
      // then wait for speech to finish before moving to the next one. This is
      // what keeps the on-screen text in sync with the voice.
      function runQueue() {
        if (queueRunning) return;
        queueRunning = true;

        const step = () => {
          if (queue.length === 0) {
            queueRunning = false;
            if (streamDone) resolveWhenDone?.();
            return;
          }
          const sentence = queue.shift();
          const prefix = sentenceIndex === 0 ? "" : " ";
          sentenceIndex += 1;
          let revealed = false;
          const reveal = () => {
            if (revealed) return;
            revealed = true;
            appendToAssistant(prefix + sentence);
          };
          speakRef.current(sentence, {
            // Reveal the words right as speaking starts, so text tracks voice.
            onStart: reveal,
            // Safety net: if speech can't start (unsupported), still show text
            // and move on.
            onEnd: () => {
              reveal();
              step();
            },
          });
        };
        step();
      }

      let fullReply = "";
      let unspokenLen = 0; // chars already pushed into the queue
      try {
        await streamChat(text, history, (chunk) => {
          fullReply += chunk;

          if (!speakOn) {
            // Voice off: stream text straight to the bubble (fast path).
            appendToAssistant(chunk);
            return;
          }

          // Voice on: hold text back; enqueue only fully-completed sentences.
          const pending = fullReply.slice(unspokenLen);
          const match = pending.match(/^[\s\S]*[.!?]/); // up to last sentence end
          if (match) {
            const completed = match[0];
            const sentences = splitIntoSentences(completed);
            sentences.forEach((s) => queue.push(s));
            unspokenLen += completed.length;
            runQueue();
          }
        });

        if (speakOn) {
          // Flush any trailing text with no ending punctuation.
          const tail = fullReply.slice(unspokenLen).trim();
          if (tail) queue.push(tail);
          streamDone = true;
          runQueue();
          // Wait until every queued sentence has been spoken+shown.
          if (queue.length > 0 || queueRunning) await allSpoken;
        }
      } catch (err) {
        setError(err.message);
        setMessages((prev) => {
          const next = [...prev];
          if (
            next.length &&
            next[next.length - 1].role === "assistant" &&
            !next[next.length - 1].content
          ) {
            next[next.length - 1] = {
              role: "assistant",
              content:
                "⚠️ Sorry, I couldn't get a response. Check the backend connection.",
            };
          }
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, appendToAssistant]
  );

  // --- Voice (mic + speaker) --------------------------------------------
  const {
    listening,
    speaking,
    interim,
    supported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    primeSpeech,
  } = useSpeech({
    // When the browser finalizes what the user said, send it.
    onFinalTranscript: (finalText) => submitMessage(finalText),
  });

  // Keep the speak ref pointing at the current hook function.
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  // --- Effects -----------------------------------------------------------
  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e) => setError(`Can't reach backend: ${e.message}`));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, interim]);

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  function toggleVoiceReplies() {
    const next = !voiceReplies;
    setVoiceReplies(next);
    if (next) {
      // Turning voice on is a user tap — use it to unlock mobile audio.
      primeSpeech();
    } else {
      stopSpeaking(); // turning off should silence any current speech
    }
  }

  const modelReady = health?.ollama?.model_present;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              AI Audio Support
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Tap the mic and talk — answers come back as voice + text.
            </p>
            <StatusBadge health={health} error={error} />
          </div>
          {/* Speaker on/off */}
          <button
            onClick={toggleVoiceReplies}
            title={voiceReplies ? "Voice replies on" : "Voice replies off"}
            className="mt-1 shrink-0 rounded-full border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.15]"
          >
            {voiceReplies ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-zinc-950"
        >
          {messages.length === 0 && !interim && (
            <p className="mt-8 text-center text-sm text-zinc-400">
              🎤 Tap the mic and ask something — or type below.
            </p>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
          {/* Live transcription of what the user is saying right now. */}
          {interim && <Bubble role="user" content={interim} ghost />}
        </div>

        {/* Mic — the primary control */}
        <div className="mt-5 flex flex-col items-center">
          <button
            onClick={toggleMic}
            disabled={!supported.stt}
            aria-label={listening ? "Stop listening" : "Start listening"}
            className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl shadow-lg transition-all disabled:opacity-40 ${
              listening
                ? "animate-pulse bg-red-500 text-white ring-4 ring-red-300"
                : "bg-black text-white hover:scale-105 dark:bg-white dark:text-black"
            }`}
          >
            {listening ? "⏹" : "🎤"}
          </button>
          <p className="mt-2 h-5 text-xs text-zinc-500 dark:text-zinc-400">
            {!supported.stt
              ? "Mic not supported in this browser — try Chrome/Edge"
              : listening
              ? "Listening… tap to stop"
              : speaking
              ? "Speaking…"
              : "Tap to speak"}
          </p>
        </div>

        {/* Text input — secondary */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMessage(input);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              modelReady === false ? "Model not loaded on server…" : "…or type a message"
            }
            className="flex-1 rounded-full border border-black/[.12] bg-white px-4 py-2.5 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:bg-zinc-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-zinc-200 px-5 py-2.5 text-sm font-medium text-black transition-opacity disabled:opacity-40 dark:bg-zinc-800 dark:text-white"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, content, ghost }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-black text-white dark:bg-white dark:text-black"
            : "bg-zinc-100 text-black dark:bg-zinc-800 dark:text-zinc-100"
        } ${ghost ? "opacity-50 italic" : ""}`}
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
