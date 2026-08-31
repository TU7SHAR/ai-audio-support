"use client";

// Browser voice hook: speech-to-text (mic) + text-to-speech (speaker).
//
// Uses the built-in Web Speech API — no libraries, no server work, free.
//   - SpeechRecognition  -> turns the user's speech into text
//   - speechSynthesis     -> speaks the assistant's replies out loud
//
// Language:
//   - Pass `language` (a BCP-47 tag like "hi-IN", "pa-IN", "en-US").
//   - "auto" (or empty) uses the browser default for recognition and lets TTS
//     pick a voice matching the text's language.
//   - Real-world support for non-English (esp. Punjabi) varies by device: the
//     phone/desktop must actually have that STT engine and TTS voice installed.
//     We degrade gracefully (fall back to an available voice) rather than break.
//
// Mobile notes:
//   - Mobile browsers require speech to be "unlocked" by a real user tap before
//     any speak() will produce sound. `primeSpeech()` does that from the mic tap.
//   - Voices load asynchronously; we wait for them and re-pick when they arrive.

import { useCallback, useEffect, useRef, useState } from "react";

function getRecognition() {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// Pick the best available voice for a language tag, falling back sensibly.
function pickVoiceForLang(langTag) {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const tag = (langTag || "").toLowerCase();
  const base = tag.split("-")[0];

  if (base) {
    // Exact tag match first (e.g. "hi-in"), then language match (e.g. "hi").
    const exact = voices.find((v) => v.lang && v.lang.toLowerCase() === tag);
    if (exact) return exact;
    const byLang = voices.find(
      (v) => v.lang && v.lang.toLowerCase().split("-")[0] === base
    );
    if (byLang) return byLang;
  }
  // Fall back to English, then whatever exists.
  return (
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang && v.lang.startsWith("en")) ||
    voices[0]
  );
}

export function useSpeech({ onFinalTranscript, language } = {}) {
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
  const primedRef = useRef(false); // has speech been unlocked by a user tap?

  // Keep the latest language in a ref so handlers use the current value.
  const langRef = useRef(language);
  useEffect(() => {
    langRef.current = language;
    // Keep recognition's language in sync when the user changes it.
    if (recognitionRef.current && language && language !== "auto") {
      recognitionRef.current.lang = language;
    }
  }, [language]);

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

    recognition.lang = language && language !== "auto" ? language : "en-US";
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
    // Only set up once; language changes are handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- unlock speech on a real user gesture (critical for mobile) --------
  const primeSpeech = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (primedRef.current) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; // silent primer
      window.speechSynthesis.speak(u);
      primedRef.current = true;
    } catch {
      /* ignore */
    }
  }, []);

  // --- mic controls ------------------------------------------------------
  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listening) return;
    // Apply the current language right before starting.
    if (langRef.current && langRef.current !== "auto") {
      recognition.lang = langRef.current;
    }
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
  // speak(text, { onStart, onEnd, lang })
  const speak = useCallback((text, { onStart, onEnd, lang } = {}) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onEnd?.();
      return;
    }
    if (!text || !text.trim()) {
      onEnd?.();
      return;
    }

    const synth = window.speechSynthesis;
    // Mobile browsers sometimes "pause" the queue; nudge it back to life.
    if (synth.paused) {
      try {
        synth.resume();
      } catch {
        /* ignore */
      }
    }

    const wantLang = lang || (langRef.current !== "auto" ? langRef.current : "");
    const utterance = new SpeechSynthesisUtterance(text.trim());
    const voice = pickVoiceForLang(wantLang);
    if (voice) utterance.voice = voice;
    utterance.lang = wantLang || voice?.lang || "en-US";
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    utterance.onstart = () => {
      setSpeaking(true);
      onStart?.();
    };
    utterance.onend = () => {
      setSpeaking(false);
      onEnd?.();
    };
    utterance.onerror = () => {
      setSpeaking(false);
      onEnd?.();
    };
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
