"use client";

// AI Audio Support — voice-first chat page.
//
// Primary interaction is the microphone: the user taps it, speaks, their words
// appear live in a chat bubble, and the assistant's reply is BOTH streamed into
// a bubble AND spoken aloud. A text input is kept as a secondary option.
//
// Voice uses the browser's built-in Web Speech API (see lib/useSpeech.js).

import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat, getHealth, API_BASE_URL } from "@/lib/api";
import { useSpeech } from "@/lib/useSpeech";
import { useSessions } from "@/lib/useSessions";

const SETTINGS_KEY = "aas.settings.v1";

// Break a block of text into sentence-sized chunks for the synced queue.
function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

// Reveal a sentence word-by-word over roughly the time it takes to speak it,
// so on-screen text flows in sync with the voice. Returns a cancel function.
function streamWords(sentence, appendChunk, done, { totalMs } = {}) {
  const words = sentence.split(/(\s+)/);
  const realWords = words.filter((w) => w.trim()).length || 1;
  const duration = totalMs || realWords * 340;
  const perToken = Math.max(30, duration / words.length);
  let i = 0;
  let timer = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    done?.();
  };
  const tick = () => {
    if (i >= words.length) {
      finish();
      return;
    }
    appendChunk(words[i]);
    i += 1;
    timer = setTimeout(tick, perToken);
  };
  tick();
  return () => {
    if (timer) clearTimeout(timer);
    while (i < words.length) {
      appendChunk(words[i]);
      i += 1;
    }
    finish();
  };
}

// Languages offered in the picker. `code` is the BCP-47 tag for the browser
// mic/voice; `apiLang` is the short code sent to the backend.
const LANGUAGES = [
  { code: "auto", apiLang: null, label: "Auto (detect)" },
  { code: "en-US", apiLang: "en", label: "English" },
  { code: "hi-IN", apiLang: "hi", label: "हिन्दी Hindi" },
  { code: "pa-IN", apiLang: "pa", label: "ਪੰਜਾਬੀ Punjabi" },
  { code: "bn-IN", apiLang: "bn", label: "বাংলা Bengali" },
  { code: "ta-IN", apiLang: "ta", label: "தமிழ் Tamil" },
  { code: "te-IN", apiLang: "te", label: "తెలుగు Telugu" },
  { code: "mr-IN", apiLang: "mr", label: "मराठी Marathi" },
  { code: "gu-IN", apiLang: "gu", label: "ગુજરાતી Gujarati" },
  { code: "es-ES", apiLang: "es", label: "Español Spanish" },
  { code: "fr-FR", apiLang: "fr", label: "Français French" },
];

function nowTs() {
  return Date.now();
}

// Read persisted settings once (client-side only). SSR returns defaults.
function loadSettings() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export default function Home() {
  // Multiple conversations, persisted. `messages`/`setMessages` operate on the
  // currently-active session.
  const {
    sessions,
    activeId,
    activeMessages: messages,
    setActiveMessages: setMessages,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    clearActive,
  } = useSessions();

  const [input, setInput] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [voiceReplies, setVoiceReplies] = useState(
    () => loadSettings().voiceReplies ?? true
  );
  const [langCode, setLangCode] = useState(() => loadSettings().langCode ?? "auto");
  const [webSearch, setWebSearch] = useState(() => loadSettings().webSearch ?? false);
  const [phase, setPhase] = useState("idle"); // idle | thinking | streaming
  const [moreComing, setMoreComing] = useState(false);
  const scrollRef = useRef(null);

  const speakRef = useRef({ speak: () => {}, stop: () => {} });
  const voiceRepliesRef = useRef(voiceReplies);
  const langRef = useRef(langCode);
  const webSearchRef = useRef(webSearch);
  const abortRef = useRef(null); // AbortController for the active request
  const stoppedRef = useRef(false); // user pressed Stop

  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
  }, [voiceReplies]);
  useEffect(() => {
    langRef.current = langCode;
  }, [langCode]);
  useEffect(() => {
    webSearchRef.current = webSearch;
  }, [webSearch]);

  // Settings persistence (conversations are persisted by useSessions).
  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ voiceReplies, langCode, webSearch })
      );
    } catch {
      /* ignore */
    }
  }, [voiceReplies, langCode, webSearch]);

  const appendToAssistant = useCallback(
    (text) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          role: "assistant",
          content: last.content + text,
        };
        return next;
      });
    },
    [setMessages]
  );

  // --- Stop the current reply -------------------------------------------
  const stopEverything = useCallback(() => {
    stoppedRef.current = true;
    try {
      abortRef.current?.abort();
    } catch {
      /* ignore */
    }
    speakRef.current?.stop?.();
    setPhase("idle");
    setMoreComing(false);
    setBusy(false);
  }, []);

  // --- Core send logic (shared by mic and text) --------------------------
  const submitMessage = useCallback(
    async (rawText) => {
      const text = (rawText || "").trim();
      if (!text || busy) return;

      setError("");
      setInput("");
      setBusy(true);
      setPhase("thinking");
      setMoreComing(false);
      stoppedRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      let history;
      setMessages((prev) => {
        history = prev.map((m) => ({ role: m.role, content: m.content }));
        return [
          ...prev,
          { role: "user", content: text, ts: nowTs() },
          { role: "assistant", content: "", ts: nowTs() },
        ];
      });

      const speakOn = voiceRepliesRef.current;
      const selected = LANGUAGES.find((l) => l.code === langRef.current);
      const apiLang = selected?.apiLang || null;
      const chatOpts = {
        language: apiLang,
        webSearch: webSearchRef.current,
        signal: controller.signal,
      };

      const queue = [];
      let queueRunning = false;
      let streamDone = false;
      let sentenceIndex = 0;
      let resolveWhenDone;
      const allSpoken = new Promise((res) => (resolveWhenDone = res));

      const refreshMoreComing = () => setMoreComing(queue.length > 0);

      function runQueue() {
        if (queueRunning) return;
        queueRunning = true;
        const step = () => {
          if (stoppedRef.current || queue.length === 0) {
            queueRunning = false;
            setMoreComing(false);
            if (streamDone || stoppedRef.current) resolveWhenDone?.();
            return;
          }
          const sentence = queue.shift();
          refreshMoreComing();
          const prefix = sentenceIndex === 0 ? "" : " ";
          sentenceIndex += 1;
          if (prefix) appendToAssistant(prefix);

          let cancelStream = null;
          let advanced = false;
          const advance = () => {
            if (advanced) return;
            advanced = true;
            step();
          };

          setPhase("streaming");
          speakRef.current.speak(sentence, {
            onStart: () => {
              cancelStream = streamWords(sentence, appendToAssistant, () => {});
            },
            onEnd: () => {
              if (cancelStream) cancelStream();
              advance();
            },
          });

          setTimeout(() => {
            if (!advanced && !cancelStream) {
              appendToAssistant(sentence);
              advance();
            }
          }, 1500);
        };
        step();
      }

      let fullReply = "";
      let unspokenLen = 0;
      let sawFirst = false;
      let citations = [];
      try {
        const result = await streamChat(
          text,
          history,
          (chunk) => {
            if (stoppedRef.current) return;
            fullReply += chunk;

            if (!speakOn) {
              if (!sawFirst) {
                sawFirst = true;
                setPhase("streaming");
              }
              appendToAssistant(chunk);
              return;
            }

            const pending = fullReply.slice(unspokenLen);
            const match = pending.match(/^[\s\S]*[.!?]/);
            if (match) {
              const completed = match[0];
              splitIntoSentences(completed).forEach((s) => queue.push(s));
              unspokenLen += completed.length;
              sawFirst = true;
              refreshMoreComing();
              runQueue();
            }
          },
          chatOpts
        );
        citations = result?.citations || [];

        if (speakOn && !stoppedRef.current) {
          const tail = fullReply.slice(unspokenLen).trim();
          if (tail) queue.push(tail);
          streamDone = true;
          refreshMoreComing();
          runQueue();
          if (queue.length > 0 || queueRunning) await allSpoken;
        }

        // Attach any web-search citations to the finished assistant message.
        if (citations.length && !stoppedRef.current) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, citations };
            }
            return next;
          });
        }
      } catch (err) {
        // A user-initiated abort is not an error — just stop quietly.
        if (err?.name === "AbortError" || stoppedRef.current) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && !last.content) {
              next[next.length - 1] = { ...last, content: "⏹ (stopped)" };
            }
            return next;
          });
        } else {
          setError(err.message || "Request failed");
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && !last.content) {
              next[next.length - 1] = {
                ...last,
                content: "⚠️ Sorry, I couldn't get a response. Check the connection.",
              };
            }
            return next;
          });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setPhase("idle");
        setMoreComing(false);
      }
    },
    [busy, appendToAssistant, setMessages]
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
    onFinalTranscript: (finalText) => submitMessage(finalText),
    language: langCode,
  });

  // Expose both speak + stop through the ref used inside submitMessage.
  useEffect(() => {
    speakRef.current = { speak, stop: stopSpeaking };
  }, [speak, stopSpeaking]);

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
  }, [messages, interim, phase]);

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  function toggleVoiceReplies() {
    const next = !voiceReplies;
    setVoiceReplies(next);
    if (next) primeSpeech();
    else stopSpeaking();
  }

  function clearConversation() {
    stopEverything();
    clearActive();
    setError("");
  }

  function newChat() {
    stopEverything();
    createSession();
    setError("");
    setShowSessions(false);
  }

  const modelReady = health?.ollama?.model_present;
  // Detect the classic HTTPS-page → HTTP-API mixed-content trap.
  const mixedContent =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    API_BASE_URL.startsWith("http:");

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              AI Audio Support
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Tap the mic and talk — answers come back as voice + text.
            </p>
            <StatusBadge health={health} error={error} />
          </div>
          <div className="mt-1 flex shrink-0 flex-col items-end gap-2">
            <select
              value={langCode}
              onChange={(e) => setLangCode(e.target.value)}
              title="Language"
              className="rounded-full border border-black/[.12] bg-white px-3 py-1.5 text-sm text-black dark:border-white/[.15] dark:bg-zinc-900 dark:text-white"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setWebSearch((v) => !v)}
                disabled={health && !health.web_search_enabled}
                title={
                  health && !health.web_search_enabled
                    ? "Web search not configured on the server (set BRAVE_API_KEY)"
                    : "Answer using live web search"
                }
                className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 ${
                  webSearch
                    ? "border-transparent bg-blue-600 text-white"
                    : "border-black/[.12] dark:border-white/[.15]"
                }`}
              >
                {webSearch ? "🌐 Web on" : "🌐 Web off"}
              </button>
              <button
                onClick={toggleVoiceReplies}
                title={voiceReplies ? "Voice replies on" : "Voice replies off"}
                className="rounded-full border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.15]"
              >
                {voiceReplies ? "🔊 Voice on" : "🔇 Voice off"}
              </button>
              <button
                onClick={() => setShowSessions((v) => !v)}
                title="Your conversations"
                className="rounded-full border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.15]"
              >
                💬 Chats ({sessions.length})
              </button>
              <button
                onClick={newChat}
                title="Start a new conversation"
                className="rounded-full border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.15]"
              >
                ＋ New
              </button>
              <button
                onClick={clearConversation}
                disabled={messages.length === 0 && !busy}
                title="Clear this conversation"
                className="rounded-full border border-black/[.12] px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/[.15]"
              >
                🗑 Clear
              </button>
            </div>
          </div>
        </header>

        {/* Sessions panel */}
        {showSessions && (
          <SessionsPanel
            sessions={sessions}
            activeId={activeId}
            onSwitch={(id) => {
              stopEverything();
              switchSession(id);
              setShowSessions(false);
            }}
            onRename={renameSession}
            onDelete={deleteSession}
            onNew={newChat}
            onClose={() => setShowSessions(false)}
          />
        )}

        {/* Mixed-content warning (deployed HTTPS site can't call an HTTP API) */}
        {mixedContent && (
          <div className="mb-3 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            ⚠️ This page is HTTPS but the API URL is HTTP, so the browser will
            block requests. Use an HTTPS API URL (e.g. a tunnel) in
            <code className="mx-1">NEXT_PUBLIC_API_BASE_URL</code>.
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-zinc-950"
        >
          {messages.length === 0 && !interim && phase === "idle" && (
            <div className="mt-10 text-center text-sm text-zinc-400">
              <p className="text-3xl">🎤</p>
              <p className="mt-2">Tap the mic and ask something — or type below.</p>
              <p className="mt-1 text-xs">
                Tip: pick a language, and toggle 🌐 for live web answers.
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === "assistant" && i === messages.length - 1;
            // Skip the empty placeholder assistant bubble — the Thinking bubble
            // stands in for it, so we don't show two blobs at once.
            if (m.role === "assistant" && !m.content && isLastAssistant) return null;
            return (
              <Bubble
                key={i}
                role={m.role}
                content={m.content}
                ts={m.ts}
                citations={m.citations}
                moreComing={isLastAssistant && moreComing}
                streaming={isLastAssistant && phase === "streaming"}
              />
            );
          })}
          {phase === "thinking" && <ThinkingBubble webSearch={webSearch} />}
          {interim && <Bubble role="user" content={interim} ghost />}
        </div>

        {/* Mic — the primary control */}
        <div className="mt-5 flex flex-col items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleMic}
              disabled={!supported.stt || busy}
              aria-label={listening ? "Stop listening" : "Start listening"}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl shadow-lg transition-all disabled:opacity-40 ${
                listening
                  ? "animate-pulse bg-red-500 text-white ring-4 ring-red-300"
                  : "bg-black text-white hover:scale-105 dark:bg-white dark:text-black"
              }`}
            >
              {listening ? "⏹" : "🎤"}
            </button>
            {/* Stop button appears only while a reply is in progress. */}
            {busy && (
              <button
                onClick={stopEverything}
                title="Stop"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-950 dark:text-red-400"
              >
                ⏹
              </button>
            )}
          </div>
          <div className="mt-2 flex h-5 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {!supported.stt ? (
              "Mic not supported in this browser — try Chrome/Edge"
            ) : listening ? (
              "Listening… tap to stop"
            ) : phase === "thinking" ? (
              <>
                Thinking
                <span className="inline-flex gap-1">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </>
            ) : speaking || phase === "streaming" ? (
              <>
                Answering
                <span className="inline-flex items-end gap-0.5">
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                </span>
              </>
            ) : (
              "Tap to speak"
            )}
          </div>
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

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Bubble({ role, content, ghost, moreComing, streaming, ts, citations }) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-black text-white dark:bg-white dark:text-black"
            : "bg-zinc-100 text-black dark:bg-zinc-800 dark:text-zinc-100"
        } ${ghost ? "opacity-50 italic" : ""}`}
      >
        {content ? (
          <>
            {content}
            {streaming && <span className="caret" />}
          </>
        ) : (
          <span className="opacity-40">…</span>
        )}
        {moreComing && (
          <span
            className="ml-2 inline-flex gap-1 align-middle text-zinc-500 dark:text-zinc-400"
            title="More response coming"
          >
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        )}
        {/* Web-search sources under the answer. */}
        {citations && citations.length > 0 && (
          <div className="mt-2 border-t border-black/10 pt-2 text-xs dark:border-white/10">
            <div className="mb-1 font-medium opacity-70">Sources</div>
            <ol className="space-y-0.5">
              {citations.map((c) => (
                <li key={c.n} className="truncate">
                  <span className="opacity-60">[{c.n}]</span>{" "}
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted hover:opacity-80"
                  >
                    {c.title || c.url}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      {/* Meta row: timestamp + copy (copy only for real, non-ghost content). */}
      {!ghost && content && (
        <div
          className={`mt-0.5 flex items-center gap-2 px-1 text-[10px] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 ${
            isUser ? "flex-row-reverse" : ""
          }`}
        >
          <span>{formatTime(ts)}</span>
          <button onClick={copy} className="hover:text-zinc-600 dark:hover:text-zinc-200">
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function ThinkingBubble({ webSearch }) {
  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-2 rounded-2xl bg-zinc-100 px-4 py-3 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <span className="inline-flex gap-1">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
        {webSearch && <span className="text-xs">searching the web…</span>}
      </div>
    </div>
  );
}

function SessionsPanel({ sessions, activeId, onSwitch, onRename, onDelete, onNew, onClose }) {
  return (
    <div className="mb-3 rounded-xl border border-black/[.08] bg-white p-3 dark:border-white/[.12] dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Your conversations</span>
        <div className="flex gap-2">
          <button
            onClick={onNew}
            className="rounded-full bg-black px-3 py-1 text-xs text-white dark:bg-white dark:text-black"
          >
            ＋ New chat
          </button>
          <button onClick={onClose} className="rounded-full px-2 text-sm opacity-60">
            ✕
          </button>
        </div>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
              s.id === activeId
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
            }`}
          >
            <button
              onClick={() => onSwitch(s.id)}
              className="flex-1 truncate text-left"
              title={s.title}
            >
              {s.title || "Untitled"}
            </button>
            <button
              onClick={() => {
                const t = prompt("Rename conversation", s.title);
                if (t !== null) onRename(s.id, t);
              }}
              className="text-xs opacity-50 hover:opacity-100"
              title="Rename"
            >
              ✏️
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this conversation?")) onDelete(s.id);
              }}
              className="text-xs opacity-50 hover:opacity-100"
              title="Delete"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
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
