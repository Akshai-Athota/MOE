import { useCallback, useEffect, useRef, useState } from "react";

/** Live German speech-to-text via the browser's Web Speech API (Chrome/Edge). Falls back gracefully. */
export function useSpeech(onText: (text: string) => void) {
  const Rec = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!Rec) return;
    const r = new Rec();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      cb.current(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [Rec]);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported: !!Rec, listening, start, stop };
}
