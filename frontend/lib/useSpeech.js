"use client";

// Browser voice hook: speech-to-text (mic) + text-to-speech (speaker).
//
// Uses the built-in Web Speech API — no libraries, no server work, free.
//   - SpeechRecognition  -> turns the user's speech into text
//   - speechSynthesis     -> speaks the assistant's replies out loud
//
// Support notes:
//   - Works best in Chrome / Edge / Brave (Chromium). Safari has partial
//     support. Firefox does not support SpeechRecognition.
//   - The mic requires a secure context (https:// or localhost). Vercel is
//     https, so it's fine there.

import { useCallback, useEffect, useRef, useState } from "react";

function getRecognition() {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function useSpeech({ onFinalTranscript } = {}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState(""); // live, not-yet-final words
  // Detect support once, lazily, so we never call setState inside an effect.
  const [supported] = useState(() => {
    if (typeof window === "undefined") return { stt: false, tts: false };
    const stt = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const tts = "speechSynthesis" in window;
    return { stt, tts };
  });

  const recognitionRef = useRef(null);
  // Keep the latest callback in a ref so the recognition handlers always call
  // the current version without us having to re-create the recognition object.
  const onFinalRef = useRef(onFinalTranscript);
  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  // --- set up SpeechRecognition once ------------------------------------
  useEffect(() => {
    const recognition = getRecognition();
    if (!recognition) return;

    recognition.lang = "en-US";
    recognition.interimResults = true; // show words as they're spoken
    recognition.continuous = false; // stop automatically after a pause

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        onFinalRef.current?.(finalText.trim());
      }
    };

    recognition.onerror = () => {
      setListening(false);
      setInterim("");
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // --- mic controls ------------------------------------------------------
  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listening) return;
    // Don't listen to ourselves talking.
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }, [listening]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  // --- text-to-speech ----------------------------------------------------
  const speak = useCallback((text) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!text || !text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.0;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return {
    listening,
    speaking,
    interim,
    supported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
