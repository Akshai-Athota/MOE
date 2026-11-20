import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Gift, Mic, Pause, Play, RotateCcw, Square, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FinnAvatar, Reveal } from "../components/motion";
import { Button, PageHeader, Spinner, cx } from "../components/ui";
import { interviewApi, type IvSession } from "../lib/api";
import { DATA, daysUntil, fmtDate, personaById } from "../lib/data";
import { dealDeck, phraseCard, processAnswer } from "../lib/engine";
import { INTERVIEW_KEY, useStore } from "../lib/store";
import type { Voucher } from "../lib/types";
import { mmss, useRecorder } from "../lib/useRecorder";
import { useSpeech } from "../lib/useSpeech";

/* ------------------------------------------------------------------ model */
interface Card {
  card: number;
  kind: "open_question" | "gap" | "catalogue";
  original: string;
  text: string;
  done: boolean;
  pending?: boolean;
  failed?: boolean;
  askedBy?: string;
  ref?: string;
  gapId?: string;
  demoAnswer?: string;
}
interface Note {
  card: number;
  section: string;
  text: string;
}
interface Saved {
  mode: "live" | "demo";
  sid?: string;
  deck: Card[];
  notes: Note[];
  voucher?: Voucher | null;
  revealed?: boolean;
}

const fromSession = (s: IvSession): Pick<Saved, "deck" | "notes" | "voucher"> => ({
  deck: s.deck.map((c) => ({
    card: c.card,
    kind: c.kind,
    original: c.original,
    text: c.text || c.original,
    done: c.done,
    pending: c.pending,
    failed: c.failed,
    askedBy: c.asked_by ?? undefined,
    ref: c.ref ?? undefined,
    gapId: c.gap_id ?? undefined,
    demoAnswer: c.demo_answer ?? undefined,
  })),
  notes: s.turns.flatMap((t) => t.claims.map((c) => ({ card: t.question.card ?? 0, section: c.section, text: c.text }))),
  voucher: s.reward?.voucher ?? null,
});

const dedupe = (notes: Note[]) => {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const k = n.text.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

type Answer = { text?: string; audio?: Blob; filename?: string; spoken?: string };

/* ------------------------------------------------------------------ view */
export default function InterviewView() {
  const { user, backend, openQuestions, resolveOpenQuestion, learn, engineState, toast } = useStore();
  const me = personaById(user.personaId)!;
  const first = me.name.split(" ")[0];
  const key = INTERVIEW_KEY + me.id;
  const [st, setSt] = useState<Saved | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const stRef = useRef<Saved | null>(null);
  stRef.current = st;

  const persist = useCallback(
    (next: Saved | ((s: Saved) => Saved)) =>
      setSt((cur) => {
        const v = typeof next === "function" ? (cur ? next(cur) : cur) : next;
        try {
          if (v) localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* ignore */
        }
        return v;
      }),
    [key],
  );

  // deal (backend when connected, otherwise the in-browser twin)
  useEffect(() => {
    if (backend === "checking") return;
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      /* ignore */
    }
    const mode = backend === "live" ? "live" : "demo";
    if (saved && saved.mode === mode && saved.deck?.[0]?.text) {
      setSt(saved);
      if (mode === "live" && saved.sid) interviewApi.get(saved.sid).then((s) => persist((c) => ({ ...c, ...fromSession(s) }))).catch(() => undefined);
      return;
    }
    const mine = openQuestions.filter((q) => q.routedTo === me.id && !q.resolved);
    if (mode === "live") {
      setBusy(true);
      interviewApi
        .start(me.id, mine.map((q) => ({ id: q.id, text: q.text, asked_by: q.askedBy, gap_id: q.gapId })))
        .then((s) => persist({ mode, sid: s.id, ...fromSession(s) }))
        .catch(() => toast({ title: "Interview konnte nicht starten" }))
        .finally(() => setBusy(false));
    } else {
      const deck = dealDeck(me.id, mine).map((c) => ({
        card: c.card,
        kind: c.kind,
        original: c.original,
        text: phraseCard({ ...c, openQuestionId: c.openQuestionId }, me.id),
        done: false,
        askedBy: c.askedBy,
        ref: c.openQuestionId ?? c.ref,
        gapId: c.gapId,
        demoAnswer: c.demoAnswer,
      }));
      persist({ mode, deck, notes: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, me.id]);

  // live: while answers are processed in the background, refresh quietly
  const anyPending = !!st?.deck.some((c) => c.pending);
  useEffect(() => {
    if (st?.mode !== "live" || !st.sid || !anyPending) return;
    const t = setInterval(() => {
      interviewApi
        .get(st.sid!)
        .then((s) => persist((c) => ({ ...c, ...fromSession(s) })))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [st?.mode, st?.sid, anyPending, persist]);

  const deck = st?.deck ?? [];
  const doneCount = deck.filter((c) => c.done).length;
  const finished = deck.length > 0 && doneCount === deck.length;
  const remaining = deck.filter((c) => !c.done);

  const closeColleagueQuestion = (c: Card) => {
    const oq = openQuestions.find((q) => !q.resolved && ((c.ref && q.id === c.ref) || (c.gapId && q.gapId === c.gapId)));
    if (oq) resolveOpenQuestion(oq.id);
  };

  /** Accept the answer at once; transcription / structuring happen in the background. */
  const submit = (c: Card, a: Answer) => {
    const s = stRef.current;
    if (!s) return;
    persist((cur) => ({ ...cur, deck: cur.deck.map((x) => (x.card === c.card ? { ...x, done: true, pending: true, failed: false } : x)) }));
    closeColleagueQuestion(c);

    if (s.mode === "live" && s.sid) {
      const call = a.audio ? interviewApi.submitAudio(s.sid, c.card, a.audio, a.filename) : interviewApi.submit(s.sid, c.card, a.text!);
      call
        .then((r) => persist((cur) => ({ ...cur, ...fromSession(r) })))
        .catch(() => {
          persist((cur) => ({ ...cur, deck: cur.deck.map((x) => (x.card === c.card ? { ...x, done: false, pending: false, failed: true } : x)) }));
          toast({ title: "Antwort nicht angekommen", body: `Karte ${c.card} bitte noch einmal.` });
        });
      return;
    }
    // demo mode: the browser's own transcript, typed text, or the prepared answer for uploads
    const raw = (a.text ?? a.spoken ?? "").trim() || c.demoAnswer || "";
    setTimeout(() => {
      const r = processAnswer(raw, engineState);
      const notes = r.statements.map((x) => ({ card: c.card, section: x.section, text: x.text }));
      if ((c.kind === "open_question" || c.kind === "gap") && (notes.length || !r.ignored) && r.clean.trim())
        learn({ text: r.ignored ? notes.map((n) => n.text).join(" ") : r.clean, owner: me.id, via: "interview", label: `Interview ${first[0]}. ${me.name.split(" ").slice(-1)[0]}`, gapId: c.gapId, topic: c.original.replace("?", "") });
      persist((cur) => ({
        ...cur,
        deck: cur.deck.map((x) => (x.card === c.card ? { ...x, pending: false } : x)),
        notes: dedupe([...cur.notes, ...notes]),
      }));
    }, 1400 + Math.random() * 1600);
  };

  const drawNext = (after?: number) => {
    const left = (stRef.current?.deck ?? []).filter((c) => !c.done && c.card !== after);
    setOpen(left.length ? left[Math.floor(Math.random() * left.length)].card : null);
  };

  const sections = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of dedupe(st?.notes ?? [])) m.set(n.section, [...(m.get(n.section) ?? []), n]);
    return [...m.entries()];
  }, [st?.notes]);
  const pendingCount = deck.filter((c) => c.pending).length;
  const voucher: Voucher | undefined = st?.voucher ?? (finished ? DATA.rewards.vouchers[me.id]?.[0] : undefined);
  const openCard = deck.find((c) => c.card === open);

  return (
    <div className="pb-16">
      <PageHeader
        title="Wissensinterview"
        sub={finished ? `Alle Karten beantwortet. Danke, ${first}.` : `Zieh eine Karte und erzähl – per Sprache oder Text. Noch ${daysUntil(me.leave_date!)} Tage bis ${fmtDate(me.leave_date)}.`}
        right={
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="tabular-nums">
              <span className="font-medium text-ink">{doneCount}</span> / {deck.length || "–"}
            </span>
            <span className="h-1 w-28 overflow-hidden rounded-full bg-subtle">
              <motion.span className="block h-full rounded-full bg-accent" animate={{ width: `${(doneCount / Math.max(1, deck.length)) * 100}%` }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
            </span>
          </div>
        }
      />

      <div className="px-6 pt-8 lg:px-10">
        {busy || !st ? (
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <FinnAvatar mood="thinking" size={26} /> Finn mischt die Karten …
          </div>
        ) : finished ? (
          <Finale name={first} years={me.tenure_years} voucher={voucher} revealed={!!st.revealed} onReveal={() => persist((c) => ({ ...c, revealed: true }))} pending={pendingCount} />
        ) : (
          <div className="grid max-w-[1040px] grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {deck.map((c, i) => (
              <DeckCard key={c.card} c={c} index={i} onPick={() => setOpen(c.card)} />
            ))}
          </div>
        )}

        {(sections.length > 0 || pendingCount > 0) && (
          <section className="mt-16 max-w-[1040px]">
            <Reveal>
              <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
                <div>
                  <h2 className="text-[15px] font-semibold">Dein Übergabe-Handbuch</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Wird automatisch in „Frag Finn“ übernommen.</p>
                </div>
                {pendingCount > 0 && (
                  <span className="flex items-center gap-2 text-[12.5px] text-muted">
                    <Spinner /> {pendingCount} Antwort{pendingCount > 1 ? "en" : ""} in Arbeit
                  </span>
                )}
              </div>
            </Reveal>
            <div className="divide-y divide-line">
              {sections.map(([name, notes], i) => (
                <Reveal key={name} delay={i * 0.05} className="grid gap-2 py-4 sm:grid-cols-[200px_1fr]">
                  <div className="text-[13px] text-muted">{name}</div>
                  <ul className="space-y-1.5">
                    <AnimatePresence initial={false}>
                      {notes.map((n) => (
                        <motion.li key={n.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[14px] leading-relaxed text-ink-2">
                          {n.text}
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </div>

      <AnimatePresence mode="wait">
        {openCard && (
          <CardDialog
            key={openCard.card}
            card={openCard}
            total={deck.length}
            left={remaining.length}
            live={st?.mode === "live"}
            onClose={() => setOpen(null)}
            onSubmit={(a) => {
              submit(openCard, a);
              drawNext(openCard.card);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */
function DeckCard({ c, index, onPick }: { c: Card; index: number; onPick: () => void }) {
  const face = c.done;
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: index * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      whileHover={face ? undefined : { y: -6, rotate: index % 2 ? 0.8 : -0.8 }}
      whileTap={face ? undefined : { scale: 0.97 }}
      onClick={face ? undefined : onPick}
      disabled={face}
      className={cx(
        "relative aspect-[3/4] rounded-[14px] text-left transition-shadow",
        face ? "cursor-default border border-line bg-surface p-4" : "card-back shadow-xs hover:shadow-pop",
      )}
      aria-label={face ? `Karte ${c.card}: beantwortet` : `Karte ${c.card} ziehen`}
    >
      {face ? (
        <div className="flex h-full flex-col justify-between">
          <span className="flex justify-end">
            {c.pending ? (
              <Spinner className="text-faint" />
            ) : (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </span>
          <p className="line-clamp-5 text-[13px] leading-snug text-muted">{c.original}</p>
        </div>
      ) : (
        <span className="absolute inset-3 grid place-items-center rounded-[10px] border border-white/10">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-white/15">
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          </span>
          {c.failed && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold" title="Bitte noch einmal" />}
        </span>
      )}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ dialog */
function CardDialog({ card, total, left, live, onClose, onSubmit }: { card: Card; total: number; left: number; live: boolean; onClose: () => void; onSubmit: (a: Answer) => void }) {
  const [text, setText] = useState("");
  const rec = useRecorder();
  const spoken = useRef("");
  const speech = useSpeech((t) => (spoken.current = t));
  const fileRef = useRef<HTMLInputElement>(null);
  const asker = card.askedBy ? personaById(card.askedBy) : undefined;
  const recording = rec.state === "recording";

  const startRec = async () => {
    spoken.current = "";
    await rec.start();
    if (!live && speech.supported) speech.start(); // demo mode: the browser transcribes
  };
  const stopRec = () => {
    rec.stop();
    speech.stop();
  };
  const sendText = () => text.trim().length > 1 && onSubmit({ text: text.trim() });

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} style={{ perspective: 1400 }}>
      <motion.div
        initial={{ rotateY: -70, opacity: 0, y: 16 }}
        animate={{ rotateY: 0, opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } }}
        exit={{ rotateY: 70, opacity: 0, y: -8, transition: { duration: 0.14, ease: "easeIn" } }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] overflow-hidden rounded-[16px] bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-3.5 text-[12.5px] text-muted">
          <span className="flex items-center gap-2.5">
            <FinnAvatar size={22} mood={recording ? "listening" : "idle"} />
            Karte {total - left + 1} von {total}
            {asker && <span className="text-faint">· gefragt von {asker.name}</span>}
          </span>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md hover:bg-subtle" aria-label="Schließen">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 pb-6 pt-5">
          <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.01em]">{card.text}</h3>

          <div className="mt-6">
            {rec.state === "recorded" && rec.blob ? (
              <Recorded blob={rec.blob} seconds={rec.seconds} onRetry={rec.reset} onSend={() => onSubmit({ audio: rec.blob!, spoken: spoken.current })} />
            ) : recording ? (
              <div className="flex items-center gap-4 rounded-[12px] border border-line p-3">
                <button onClick={stopRec} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger text-white" aria-label="Aufnahme beenden">
                  <Square size={14} fill="currentColor" />
                </button>
                <span className="text-[14px] font-medium tabular-nums">{mmss(rec.seconds)}</span>
                <Level level={rec.level} />
              </div>
            ) : (
              <div className="rounded-[12px] border border-line focus-within:border-line-strong">
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendText();
                    }
                  }}
                  rows={3}
                  placeholder="Schreib deine Antwort … oder nimm sie auf."
                  className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-relaxed outline-none placeholder:text-faint"
                />
                <div className="flex items-center gap-1 px-2 pb-2">
                  <button onClick={startRec} className="flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-muted hover:bg-subtle hover:text-ink" aria-label="Aufnahme starten">
                    <Mic size={15} /> Aufnehmen
                  </button>
                  <button onClick={() => fileRef.current?.click()} className="flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-muted hover:bg-subtle hover:text-ink">
                    <Upload size={14} /> Audiodatei
                  </button>
                  <button
                    onClick={sendText}
                    disabled={text.trim().length < 2}
                    className="ml-auto grid h-8 w-8 place-items-center rounded-[8px] bg-ink text-white transition-opacity disabled:opacity-25"
                    aria-label="Antwort senden"
                  >
                    <ArrowUp size={15} />
                  </button>
                </div>
              </div>
            )}
            {rec.error && <p className="mt-3 text-[12.5px] text-danger">{rec.error}</p>}
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSubmit({ audio: f, filename: f.name });
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-4 text-[12px] text-faint">Nach dem Senden geht es sofort mit der nächsten Karte weiter. Finn sortiert deine Antwort im Hintergrund.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Level({ level }: { level: number }) {
  return (
    <span className="flex h-6 flex-1 items-center gap-[3px]">
      {Array.from({ length: 24 }).map((_, i) => {
        const h = Math.max(0.15, Math.min(1, level * (0.6 + ((i * 7) % 5) / 5)));
        return <span key={i} className="w-[3px] rounded-full bg-ink/70 transition-[height] duration-75" style={{ height: `${h * 100}%` }} />;
      })}
    </span>
  );
}

function Recorded({ blob, seconds, onRetry, onSend }: { blob: Blob; seconds: number; onRetry: () => void; onSend: () => void }) {
  const [url, setUrl] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line p-2.5 pl-3">
      {url && <audio ref={audio} src={url} onEnded={() => setPlaying(false)} />}
      <button
        onClick={() => {
          if (playing) audio.current?.pause();
          else audio.current?.play();
          setPlaying(!playing);
        }}
        className="grid h-8 w-8 place-items-center rounded-full bg-subtle text-ink hover:bg-line"
        aria-label="Anhören"
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className="flex-1 text-[13px] tabular-nums text-muted">Aufnahme · {mmss(seconds)}</span>
      <Button variant="ghost" size="sm" onClick={onRetry} icon={<RotateCcw size={13} />}>
        Neu
      </Button>
      <Button size="sm" onClick={onSend}>
        Senden
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ finale: the secret card */
function Finale({ name, years, voucher, revealed, onReveal, pending }: { name: string; years: number; voucher?: Voucher; revealed: boolean; onReveal: () => void; pending: number }) {
  const [flipped, setFlipped] = useState(revealed);
  return (
    <div className="flex max-w-[1040px] flex-col items-center py-6 text-center">
      <Reveal>
        <FinnAvatar size={44} mood="happy" />
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.01em]">Geschafft, {name}.</h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-1 text-[13.5px] text-muted">
          {years} Jahre Wissen – jetzt bleibt es im Amt.{pending > 0 && ` Finn sortiert noch ${pending} Antwort${pending > 1 ? "en" : ""}.`}
        </p>
      </Reveal>

      <Reveal delay={0.22} className="mt-10">
        <div style={{ perspective: 1400 }}>
          <motion.button
            onClick={() => {
              setFlipped(true);
              onReveal();
            }}
            disabled={flipped}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            whileHover={flipped ? undefined : { y: -6 }}
            className="preserve-3d relative h-[340px] w-[260px] text-left"
            aria-label="Letzte Karte aufdecken"
          >
            {/* back */}
            <span className="card-reward backface-hidden absolute inset-0 grid place-items-center rounded-[16px] shadow-pop ring-1 ring-gold/60">
              <span className="text-center">
                <Gift size={26} className="mx-auto text-gold" />
                <span className="mt-3 block text-[13px] text-gold/80">Eine Karte gibt es noch</span>
                <span className="mt-1 block text-[12px] text-gold/50">Aufdecken</span>
              </span>
            </span>
            {/* front */}
            <span className="card-reward backface-hidden absolute inset-0 flex flex-col justify-between rounded-[16px] p-6 text-white shadow-pop ring-1 ring-gold/60" style={{ transform: "rotateY(180deg)" }}>
              <span className="text-[11.5px] uppercase tracking-[0.1em] text-gold/80">Für dich</span>
              {voucher ? (
                <span>
                  <span className="block text-[19px] font-semibold leading-snug text-gold">{voucher.title_de}</span>
                  <span className="mt-2 block text-[13px] leading-relaxed text-white/70">{voucher.detail_de}</span>
                </span>
              ) : (
                <span className="text-[14px] text-white/70">Dein Team überrascht dich bei der Verabschiedung.</span>
              )}
              {voucher && (
                <span className="flex items-end justify-between gap-3 text-[12px] text-white/50">
                  <span>Weil du gern: {voucher.based_on}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">ca. {voucher.est_eur} €</span>
                </span>
              )}
            </span>
          </motion.button>
        </div>
      </Reveal>
    </div>
  );
}
