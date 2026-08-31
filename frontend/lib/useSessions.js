"use client";

// Session management: multiple named conversations, persisted in localStorage.
//
// A "session" is one conversation: { id, title, messages: [...], updatedAt }.
// We keep a list of sessions plus which one is active. The UI can create,
// switch, rename, and delete sessions; everything is saved locally so it
// survives reloads. (No backend/account needed for the prototype.)

import { useCallback, useEffect, useState } from "react";

const SESSIONS_KEY = "aas.sessions.v1";
const ACTIVE_KEY = "aas.activeSession.v1";
const MAX_MESSAGES_PER_SESSION = 200;

function uid() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newSession(title = "New chat") {
  return { id: uid(), title, messages: [], updatedAt: Date.now() };
}

function loadSessions() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
    return null;
  } catch {
    return null;
  }
}

function loadActiveId() {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

// Derive a short title from the first user message.
function titleFrom(messages) {
  const firstUser = messages.find((m) => m.role === "user" && m.content);
  if (!firstUser) return "New chat";
  const t = firstUser.content.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

export function useSessions() {
  // Compute the initial sessions + active id together so activeId always points
  // at a real session (even on a first visit with nothing stored).
  const initial = (() => {
    const loaded = loadSessions() || [newSession()];
    const saved = loadActiveId();
    const activeId =
      saved && loaded.some((s) => s.id === saved) ? saved : loaded[0].id;
    return { loaded, activeId };
  })();

  const [sessions, setSessions] = useState(initial.loaded);
  const [activeId, setActiveId] = useState(initial.activeId);

  // Persist.
  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
      /* ignore quota */
    }
  }, [sessions]);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  const active = sessions.find((s) => s.id === activeId) || sessions[0] || null;

  // Replace the active session's messages (and refresh title/timestamp).
  const setActiveMessages = useCallback(
    (updater) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== (activeId || prev[0]?.id)) return s;
          const nextMessages =
            typeof updater === "function" ? updater(s.messages) : updater;
          const trimmed = nextMessages.slice(-MAX_MESSAGES_PER_SESSION);
          return {
            ...s,
            messages: trimmed,
            title: s.title === "New chat" ? titleFrom(trimmed) : s.title,
            updatedAt: Date.now(),
          };
        })
      );
    },
    [activeId]
  );

  const createSession = useCallback(() => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    return s.id;
  }, []);

  const switchSession = useCallback((id) => setActiveId(id), []);

  const renameSession = useCallback((id, title) => {
    const clean = (title || "").trim() || "Untitled";
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: clean } : s)));
  }, []);

  const deleteSession = useCallback(
    (id) => {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        const next = remaining.length ? remaining : [newSession()];
        // If we deleted the active one, jump to the first remaining.
        if (id === activeId) setActiveId(next[0].id);
        return next;
      });
    },
    [activeId]
  );

  const clearActive = useCallback(() => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId ? { ...s, messages: [], title: "New chat", updatedAt: Date.now() } : s
      )
    );
  }, [activeId]);

  return {
    sessions,
    activeId: active?.id || null,
    activeMessages: active?.messages || [],
    setActiveMessages,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    clearActive,
  };
}
