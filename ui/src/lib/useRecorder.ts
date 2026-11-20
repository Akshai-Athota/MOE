import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "recording" | "recorded" | "error";

/** Microphone recording with MediaRecorder + a live input level (0..1) for the meter. */
export function useRecorder() {
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError("");
    setBlob(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        setBlob(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
        setState("recorded");
        cleanup();
      };
      rec.current = r;
      r.start(250);

      const ac = new AudioContext();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((x) => x + 1), 1000);
      setState("recording");
    } catch {
      cleanup();
      setError("Kein Mikrofon verfügbar. Du kannst stattdessen eine Audiodatei hochladen.");
      setState("error");
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const resetRec = useCallback(() => {
    cleanup();
    setBlob(null);
    setSeconds(0);
    setState("idle");
  }, [cleanup]);

  useEffect(() => () => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    cleanup();
  }, [cleanup]);

  return { state, seconds, level, blob, error, start, stop, reset: resetRec };
}

export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
