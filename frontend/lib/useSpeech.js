"use client";

// Browser voice hook: speech-to-text (mic) + text-to-speech (speaker).
//
// Uses the built-in Web Speech API — no libraries, no server work, free.
//   - SpeechRecognition  -> turns the user's speech into text
//   - speechSynthesis     -> speaks the assistant's replies out loud
//
// Mobile notes (why this file is more careful than a desktop-only version):
//   - Mobile browsers (esp. iOS Safari, Android Chrome) require speech to be
//     "unlocked" by a real user tap before any speak() will produce sound. We
//     do that in `primeSpeech()`, called from the mic button's tap handler.
//   - We also wait for voices to load and pick an explicit English voice,
//     because on mobile the default voice is often empty on the first call.
//   - The mic requires a secure context (https:// or localhost). Vercel is
//     https, so it's fine there.

import { useCallback, useEffect, useRef, useState } from "react";

function getRecognition() {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// Pick a sensible English voice once the browser has loaded its voice list.
function pickEnglishVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  return (
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang && v.lang.startsWith("en")) ||
    voices[0]
  );
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
  const voiceRef = useRef(null); // chosen English voice
  const primedRef = useRef(false); // has speech been unlocked by a user tap?

  // Keep the latest callback in a ref so the recognition handlers always call
  // the current version without us having to re-create the recognition object.
  const onFinalRef = useRef(onFinalTranscript);
  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  // --- load TTS voices (they arrive asynchronously) ----------------------
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      voiceRef.current = pickEnglishVoice();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

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

  // --- unlock speech on a real user gesture (critical for mobile) --------
  // Speaks an inaudible utterance so the browser marks speech as user-approved.
  // Call this from inside a tap/click handler (we call it on the mic button).
  const primeSpeech = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (primedRef.current) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; // silent primer
      window.speechSynthesis.speak(u);
      primedRef.current = true;
      // Voices may only populate after this first call on some browsers.
      if (!voiceRef.current) voiceRef.current = pickEnglishVoice();
    } catch {
      /* ignore */
    }
  }, []);

  // --- mic controls ------------------------------------------------------
  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listening) return;
    // Unlock TTS while we still have the user's tap gesture.
    primeSpeech();
    // Don't listen to ourselves talking.
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }, [listening, primeSpeech]);

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

    const synth = window.speechSynthesis;
    // Mobile browsers sometimes "pause" the queue; nudge it back to life.
    if (synth.paused) {
      try {
        synth.resume();
      } catch {
        /* ignore */
      }
    }

    const utterance = new SpeechSynthesisUtterance(text.trim());
    const voice = voiceRef.current || pickEnglishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || "en-US";
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.speak(utterance);
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
    primeSpeech,
  };
}
