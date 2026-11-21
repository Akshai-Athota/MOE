/**
 * "Für immer dabei": a person who leaves stays part of the office as a labelled AI avatar
 * (their photo + their cloned voice). Finn finds the answer in the sources; the avatar speaks it.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Mic, Play, Send, ShieldCheck, Square, Trash2, Upload, UserPlus, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, PageHeader, Spinner, cx } from "../components/ui";
import { avatarApi, type AvatarMeta } from "../lib/avatarApi";
import type { Answer } from "../lib/avatarTypes";
import { personaById } from "../lib/data";
import { useStore } from "../lib/store";
import { mmss, useRecorder } from "../lib/useRecorder";

const READ_ALOUD =
  "Hallo, ich bin's. Ich arbeite seit vielen Jahren hier im Finanzamt Hildesheim. Am liebsten erkläre ich neuen Kolleginnen und Kollegen, wie die Dinge wirklich laufen: wer was entscheidet, wo die Unterlagen liegen und was man besser nicht vergisst. Wenn ihr Fragen habt, fragt einfach.";

/** Photo that "speaks": scale + glow follow the loudness of the playing audio. */
function SpeakingPhoto({ src, audio, size = 220 }: { src: string; audio: HTMLAudioElement | null; size?: number }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!audio) return;
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    const srcNode = ac.createMediaElementSource(audio);
    srcNode.connect(an);
    an.connect(ac.destination);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 5));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ac.close().catch(() => undefined);
    };
  }, [audio]);
  return (
    <div className="relative grid place-items-center" style={{ width: size + 40, height: size + 40 }}>
      <motion.div
        className="absolute rounded-full bg-accent/15"
        animate={{ width: size + 8 + level * 60, height: size + 8 + level * 60, opacity: 0.4 + level * 0.6 }}
        transition={{ duration: 0.08 }}
      />
      <motion.img
        src={src}
        alt=""
        className="relative rounded-full border-4 border-surface object-cover shadow-lg"
        style={{ width: size, height: size }}
        animate={{ scale: 1 + level * 0.035, y: -level * 3 }}
        transition={{ duration: 0.08 }}
      />
    </div>
  );
}

function CreateAvatar({ onCreated }: { onCreated: (a: AvatarMeta) => void }) {
  const { user } = useStore();
  const rec = useRecorder();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const voice: Blob | null = voiceFile ?? rec.blob;
  const voiceOk = !!voiceFile || (rec.blob && rec.seconds >= 10);

  const submit = async () => {
    if (!photo || !voice || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const a = await avatarApi.create({
        name: name.trim(),
        personaId: undefined,
        consent,
        photo,
        voice,
        voiceName: voiceFile?.name ?? "aufnahme.webm",
      });
      onCreated(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <UserPlus size={16} /> Neuen Avatar anlegen
      </div>

      <label className="block">
        <span className="text-[12.5px] text-muted">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={personaById(user.personaId)?.name ?? "Vor- und Nachname"}
          className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none focus:border-line-strong" />
      </label>

      <div>
        <span className="text-[12.5px] text-muted">1 · Foto (frontal, gut ausgeleuchtet)</span>
        <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong p-3 hover:bg-subtle/60">
          {photo ? <img src={URL.createObjectURL(photo)} alt="" className="h-14 w-14 rounded-full object-cover" /> : <Upload size={18} className="text-muted" />}
          <span className="text-[13px]">{photo ? photo.name : "Foto auswählen …"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div>
        <span className="text-[12.5px] text-muted">2 · Stimme – lies diesen Text in Ruhe vor (mind. 10 s, besser 30 s)</span>
        <p className="mt-1 rounded-lg bg-subtle p-3 text-[13px] leading-relaxed text-ink-2">{READ_ALOUD}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {rec.state === "recording" ? (
            <Button variant="secondary" size="sm" icon={<Square size={13} />} onClick={rec.stop}>
              Stopp · {mmss(rec.seconds)}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" icon={<Mic size={14} />} onClick={() => { setVoiceFile(null); rec.start(); }}>
              {rec.blob ? "Neu aufnehmen" : "Aufnehmen"}
            </Button>
          )}
          {rec.state === "recording" && (
            <span className="h-2 w-24 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(rec.level * 100)}%` }} />
            </span>
          )}
          <label className="cursor-pointer text-[13px] text-muted underline-offset-2 hover:underline">
            oder Audiodatei hochladen
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { rec.reset(); setVoiceFile(e.target.files?.[0] ?? null); }} />
          </label>
          {voice && <span className="text-[12px] text-accent">{voiceFile ? voiceFile.name : `Aufnahme ${mmss(rec.seconds)}`}</span>}
          {rec.blob && !voiceFile && rec.seconds < 10 && <span className="text-[12px] text-warn">zu kurz – bitte mind. 10 Sekunden</span>}
        </div>
        {rec.error && <p className="mt-1 text-[12px] text-danger">{rec.error}</p>}
      </div>

      <label className="flex items-start gap-2.5 rounded-lg bg-subtle p-3 text-[12.5px] leading-relaxed">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>
          Ich bin einverstanden, dass aus meinem Foto und meiner Stimme ein <b>gekennzeichneter KI-Avatar</b> erstellt wird. Er spricht nur Antworten aus
          geprüften Quellen. Ich kann ihn jederzeit löschen lassen. Die Daten bleiben auf diesem Rechner.
        </span>
      </label>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={!name.trim() || !photo || !voiceOk || !consent || busy} icon={busy ? <Spinner /> : <UserPlus size={15} />}>
        Avatar erstellen
      </Button>
    </div>
  );
}

export default function AvatarView() {
  const { user, backend } = useStore();
  const [avatars, setAvatars] = useState<AvatarMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = () =>
    avatarApi
      .list()
      .then((l) => {
        setAvatars(l);
        setSel((s) => s ?? l[0]?.id ?? null);
        if (!l.length) setCreating(true);
      })
      .catch(() => undefined);

  useEffect(() => {
    if (backend !== "live") return;
    load();
    avatarApi.status().then((s) => setVoiceReady(s.voice)).catch(() => setVoiceReady(false));
  }, [backend]);

  const current = avatars.find((a) => a.id === sel) ?? null;

  const play = async (text: string, lang = "de") => {
    if (!current) return;
    setBusy("Stimme wird erzeugt …");
    try {
      const url = await avatarApi.speak(current.id, text, lang);
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.crossOrigin = "anonymous";
        setAudioEl(audioRef.current);
      }
      audioRef.current.src = url;
      await audioRef.current.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wiedergabe fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  const ask = async () => {
    if (!current || !q.trim()) return;
    setError("");
    setAnswer(null);
    setBusy(`${current.name.split(" ")[0]}s Avatar sucht in den Quellen …`);
    try {
      const r = await avatarApi.ask(current.id, q.trim(), user.personaId);
      setAnswer(r.answer);
      setBusy(null);
      if (voiceReady) await play(r.answer.answer, r.lang);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!current || !confirm(`Avatar von ${current.name} endgültig löschen? Foto, Stimmprobe und Audios werden entfernt.`)) return;
    await avatarApi.remove(current.id);
    setSel(null);
    setAnswer(null);
    load();
  };

  if (backend !== "live")
    return (
      <div>
        <PageHeader title="Für immer dabei" sub="Avatare brauchen das Backend – es ist gerade nicht verbunden." />
      </div>
    );

  return (
    <div className="pb-10">
      <PageHeader
        title="Für immer dabei"
        sub="Wer geht, bleibt Teil des Amts: als gekennzeichneter KI-Avatar mit eigenem Gesicht und eigener Stimme – er spricht nur, was in den Quellen steht."
        right={
          <Button variant="secondary" size="sm" icon={<UserPlus size={14} />} onClick={() => setCreating((c) => !c)}>
            {creating ? "Abbrechen" : "Avatar anlegen"}
          </Button>
        }
      />
      <div className="mx-auto max-w-[1100px] space-y-6 px-6 pt-6 lg:px-10">
        {voiceReady === false && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            Die Stimm-KI ist auf dem Server noch nicht installiert (<code>uv sync --extra avatar</code>). Avatare können angelegt werden, sprechen aber noch nicht.
          </p>
        )}

        {avatars.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {avatars.map((a) => (
              <button key={a.id} onClick={() => { setSel(a.id); setAnswer(null); setCreating(false); }}
                className={cx("flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px]", a.id === sel ? "border-ink bg-surface" : "border-line hover:bg-subtle")}>
                <img src={avatarApi.photoUrl(a.id)} alt="" className="h-7 w-7 rounded-full object-cover" />
                {a.name}
              </button>
            ))}
          </div>
        )}

        {creating ? (
          <CreateAvatar onCreated={(a) => { setCreating(false); setSel(a.id); load(); }} />
        ) : current ? (
          <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
            <div className="flex flex-col items-center rounded-xl border border-line bg-surface p-6 text-center">
              <SpeakingPhoto src={avatarApi.photoUrl(current.id)} audio={audioEl} />
              <div className="mt-2 text-[17px] font-semibold">{current.name}</div>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
                <ShieldCheck size={12} /> KI-Avatar · synthetische Stimme
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" icon={<Play size={13} />} disabled={!voiceReady || !!busy}
                  onClick={() => play(`Hallo, ich bin der KI-Avatar von ${current.name}. Ich bin zwar nicht mehr im Amt, aber mein Wissen ist noch da. Frag mich einfach.`)}>
                  Begrüßung
                </Button>
                <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={remove}>
                  Löschen
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={`Frag ${current.name.split(" ")[0]} …`}
                  className="h-9 flex-1 bg-transparent px-2 text-[14px] outline-none" />
                <Button onClick={ask} disabled={!q.trim() || !!busy} icon={<Send size={14} />}>
                  Fragen
                </Button>
              </div>
              <AnimatePresence>
                {busy && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[13px] text-muted">
                    <Spinner /> {busy}
                  </motion.div>
                )}
              </AnimatePresence>
              {error && <p className="text-[12.5px] text-danger">{error}</p>}
              {answer && (
                <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
                  {answer.interpreted_as && <div className="text-[12px] text-faint">verstanden als: {answer.interpreted_as}</div>}
                  <p className="text-[14.5px] leading-relaxed">{answer.answer}</p>
                  {answer.citations.length > 0 && (
                    <div className="space-y-1 border-t border-line pt-3">
                      {answer.citations.map((c) => (
                        <div key={c.n} className="text-[12px] text-muted">
                          [{c.n}] {c.citation}
                        </div>
                      ))}
                    </div>
                  )}
                  {voiceReady && (
                    <Button variant="secondary" size="sm" icon={<Volume2 size={13} />} disabled={!!busy} onClick={() => play(answer.answer)}>
                      Nochmal anhören
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
