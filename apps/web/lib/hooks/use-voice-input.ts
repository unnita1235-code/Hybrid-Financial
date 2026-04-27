"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
};

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

type VoiceState = "idle" | "listening" | "error";

export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(
      typeof window.SpeechRecognition !== "undefined" ||
        typeof window.webkitSpeechRecognition !== "undefined",
    );
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setState("idle");
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setState("error");
      setError("Voice input is not supported in this browser.");
      return;
    }
    setError(null);
    const Ctor = (window.SpeechRecognition ||
      window.webkitSpeechRecognition) as SpeechRecognitionCtor;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => setState("listening");
    rec.onerror = () => {
      setState("error");
      setError("Voice recognition failed. Check microphone permissions.");
    };
    rec.onend = () => setState((p) => (p === "error" ? "error" : "idle"));
    rec.onresult = (ev) => {
      const text = Array.from(ev.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setTranscript(text);
    };

    recognitionRef.current = rec;
    rec.start();
  }, [supported]);

  const clear = useCallback(() => {
    setTranscript("");
    setError(null);
    setState("idle");
  }, []);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  return { supported, state, error, transcript, setTranscript, start, stop, clear };
}
