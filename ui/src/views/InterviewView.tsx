import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Check, Coffee, Feather, Gift, Landmark, Lightbulb, Lock, MessageCircle, Monitor, Puzzle, Route, Users, Wallet, Mic, Pause, Play, RotateCcw, Square, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CursorGlow } from "../components/CursorGlow";
import { AgentBuddy } from "../components/AgentBuddy";
import { Button, PageHeader, Spinner, cx } from "../components/ui";
import { interviewApi, type IvSession } from "../lib/api";
import { DATA, daysUntil, fmtDate, personaById } from "../lib/data";
import { DECK_MAX as DECK_SIZE, dealDeck, phraseCard, processAnswer } from "../lib/engine";
import { INTERVIEW_KEY, useStore } from "../lib/store";
import type { Voucher } from "../lib/types";
import { mmss, useRecorder } from "../lib/useRecorder";
import { useSpeech } from "../lib/useSpeech";

/* ------------------------------------------------------------------ model */
interface Card {
  card: number;
  kind: "open_question" | "gap" | "catalogue";
  label: string;
  original: string;
  done: boolean;
  askedBy?: string;
  ref?: string;
  gapId?: string;
  demoAnswer?: string;
  /** the question as Finn asks it (phrased by the backend when the deck is dealt) */
  text?: string;
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
  published: boolean;
  voucher?: Voucher | null;
}

const fromSession = (s: IvSession): Pick<Saved, "deck" | "notes" | "voucher"> => ({
  deck: s.deck.map((c) => ({ card: c.card, kind: c.kind, label: c.label, original: c.original, done: c.done, askedBy: c.asked_by ?? undefined, ref: c.ref ?? undefined, gapId: c.gap_id ?? undefined, demoAnswer: c.demo_answer ?? undefined, text: c.text })),
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

/* ------------------------------------------------------------------ view */
export default function InterviewView() {
  const { user, backend, openQuestions, resolveOpenQuestion, learn, toast } = useStore();
  const me = personaById(user.personaId)!;
  const key = INTERVIEW_KEY + me.id;
  const [st, setSt] = useState<Saved | null>(null);
  const [open, setOpen] = useState<Card | null>(null);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const persist = (s: Saved) => {
    setSt(s);
    try {
      localStorage.setItem(key, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };

  // load or deal the deck (backend when connected, otherwise the in-browser twin)
  useEffect(() => {
    if (backend === "checking") return;
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      /* ignore */
    }
    const mode = backend === "live" ? "live" : "demo";
    if (saved && saved.mode === mode) {
      if (mode === "live" && saved.sid)
        interviewApi
          .get(saved.sid)
          .then((s) => persist({ ...saved!, ...fromSession(s) }))
          .catch(() => setSt(saved));
      else setSt(saved);
      return;
    }
    const mine = openQuestions.filter((q) => q.routedTo === me.id && !q.resolved);
    if (mode === "live") {
      setBusy(true);
      interviewApi
        .start(me.id, mine.map((q) => ({ id: q.id, text: q.text, asked_by: q.askedBy, gap_id: q.gapId })))
        .then((s) => persist({ mode, sid: s.id, published: false, ...fromSession(s) }))
        .catch(() => toast({ title: "Interview konnte nicht starten" }))
        .finally(() => setBusy(false));
    } else {
      const deck = dealDeck(me.id, mine).map((c) => ({ card: c.card, kind: c.kind, label: c.label, original: c.original, done: false, askedBy: c.askedBy, ref: c.openQuestionId ?? c.ref, gapId: c.gapId, demoAnswer: c.demoAnswer }));
      persist({ mode, deck, notes: [], published: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, me.id]);

  const deck = st?.deck ?? [];
  const doneCount = deck.filter((c) => c.done).length;
  const unlocked = deck.length > 0 && doneCount === deck.length;
  const voucher: Voucher | undefined = st?.voucher ?? (unlocked ? DATA.rewards.vouchers[me.id]?.[0] : undefined);

  const onAnswered = (card: Card, notes: Note[], session?: IvSession, advance = false) => {
    if (!st) return;
    const next: Saved = session
      ? { ...st, ...fromSession(session) }
      : { ...st, deck: st.deck.map((c) => (c.card === card.card ? { ...c, done: true } : c)), notes: dedupe([...st.notes, ...notes]) };
    persist(next);
    // a colleague was waiting for this answer
    const oq = openQuestions.find((q) => !q.resolved && ((card.ref && q.id === card.ref) || (card.gapId && q.gapId === card.gapId)));
    if (oq) resolveOpenQuestion(oq.id);
    if (next.deck.every((c) => c.done)) setTimeout(() => toast({ title: "Alle Karten beantwortet", body: "Die letzte Karte ist jetzt offen." }), 400);
    if (advance) setOpen(next.deck.find((c) => !c.done && c.card !== card.card) ?? null);
  };

  // answers are processed in the background: refresh the deck until nothing is pending
  const pendingN = useRef(0);
  useEffect(() => {
    if (st?.mode !== "live" || !st.sid) return;
    const sid = st.sid;
    const t = setInterval(() => {
      interviewApi
        .get(sid)
        .then((s) => {
          const pending = s.pending?.length ?? 0;
          if (pending === 0 && pendingN.current === 0) return;
          pendingN.current = pending;
          setSt((cur) => {
            if (!cur || cur.sid !== sid) return cur;
            const next = { ...cur, ...fromSession(s) };
            try {
              localStorage.setItem(key, JSON.stringify(next));
            } catch {
              /* ignore */
            }
            return next;
          });
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [st?.mode, st?.sid, key]);

  const publish = async () => {
    if (!st) return;
    if (st.mode === "live" && st.sid) {
      try {
        const s = await interviewApi.publish(st.sid);
        persist({ ...st, ...fromSession(s), published: true });
      } catch {
        toast({ title: "Freigabe fehlgeschlagen" });
        return;
      }
    } else persist({ ...st, published: true });
    toast({ title: "Handbuch freigegeben", body: "Ab sofort in „Frag Finn“ durchsuchbar." });
  };

  const sections = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of dedupe(st?.notes ?? [])) m.set(n.section, [...(m.get(n.section) ?? []), n]);
    return [...m.entries()];
  }, [st?.notes]);

  return (
    <div className="pb-16">
      <PageHeader
        title="Wissensinterview"
        sub={`Zieh eine Karte und erzähl. Finn hört zu und schreibt mit. Noch ${daysUntil(me.leave_date!)} Tage bis ${fmtDate(me.leave_date)}.`}
        right={
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="tabular-nums">
              <span className="font-medium text-ink">{doneCount}</span> / {deck.length || DECK_SIZE}
            </span>
            <span className="h-1 w-28 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / Math.max(1, deck.length)) * 100}%` }} />
            </span>
          </div>
        }
      />

      <div className="relative isolate min-h-[calc(100vh-110px)] px-6 pb-10 pt-16 lg:px-10">
        <CursorGlow />
        <div className="relative z-10 mx-auto max-w-[1040px]">
        {busy || !st ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner /> Finn mischt die Karten …
          </div>
        ) : (
          <>
          <div className="mb-8"><AgentBuddy /></div>
          <Fan
            items={[
              ...deck.map((c, i) => ({ key: `c${c.card}`, pickable: !c.done, node: <DeckCard c={c} index={i} onPick={() => setOpen(c)} /> })),
              { key: "reward", pickable: unlocked, node: <RewardCard index={DECK_SIZE} unlocked={unlocked} remaining={deck.length - doneCount} onOpen={() => setRewardOpen(true)} /> },
            ]}
          />
          <p className="mt-6 text-center text-[13px] text-muted">
            {doneCount === 0
              ? "Fahr über die Karten und zieh eine. Jede Geschichte, die du erzählst, bleibt dem Team erhalten."
              : unlocked
                ? "Alle Karten erzählt. Die letzte Karte ist für dich."
                : `${doneCount} erzählt, noch ${deck.length - doneCount}. Welche ziehst du als Nächstes?`}
          </p>
          </>
        )}

        {sections.length > 0 && (
          <section className="mt-14">
            <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
              <div>
                <h2 className="text-[15px] font-semibold">Dein Übergabe-Handbuch</h2>
                <p className="mt-0.5 text-[13px] text-muted">{dedupe(st?.notes ?? []).length} Einträge aus deinen Antworten</p>
              </div>
              <Button variant={st?.published ? "secondary" : "primary"} size="sm" disabled={st?.published} onClick={publish} icon={st?.published ? <Check size={14} /> : undefined}>
                {st?.published ? "Freigegeben" : "Handbuch freigeben"}
              </Button>
            </div>
            <div className="divide-y divide-line">
              {sections.map(([name, notes]) => (
                <div key={name} className="grid gap-2 py-4 sm:grid-cols-[200px_1fr]">
                  <div className="text-[13px] text-muted">{name}</div>
                  <ul className="space-y-1.5">
                    {notes.map((n, i) => (
                      <li key={i} className="text-[14px] leading-relaxed text-ink-2">
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
        </div>
      </div>

      <AnimatePresence>
        {open && st && (
          <CardDialog
            key={open.card}
            card={open}
            saved={st}
            onClose={() => setOpen(null)}
            onAnswered={onAnswered}
            learnOffline={(text) =>
              learn({ text, owner: me.id, via: "interview", label: `Interview ${me.name.split(" ")[0][0]}. ${me.name.split(" ").slice(-1)[0]}`, gapId: open.gapId, topic: open.original.replace("?", "") })
            }
          />
        )}
        {rewardOpen && <RewardDialog name={me.name.split(" ")[0]} years={me.tenure_years} voucher={voucher} onClose={() => setRewardOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ fan */
type FanItem = { key: string; pickable: boolean; node: React.ReactNode };

/** Cards start as a messy pile, then spread into a fan around a pivot below the deck. Hovering lifts a card out. */
function Fan({ items }: { items: FanItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [spread, setSpread] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const jitter = useMemo(() => items.map(() => (Math.random() - 0.5) * 8), [items.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    const t = window.setTimeout(() => setSpread(true), 650);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  const n = items.length;
  const cardW = Math.max(88, Math.min(168, w / 4.6));
  const cardH = cardW * (4 / 3);
  const radius = cardH * 2.6; // distance from card centre to the pivot
  // widest half-angle that still keeps the outer cards inside the container
  const fit = (Math.asin(Math.min(1, Math.max(0, (w / 2 - cardW * 0.62) / radius))) * 180) / Math.PI;
  const maxA = Math.min(38, fit);
  const step = (maxA * 2) / Math.max(1, n - 1);
  const height = cardH + radius * (1 - Math.cos((maxA * Math.PI) / 180)) + 50;

  return (
    <div ref={ref} className="relative mx-auto w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {items.map((it, i) => {
        const base = (i - (n - 1) / 2) * step;
        const push = hover === null || hover === i ? 0 : i < hover ? -2.5 : 2.5;
        const lifted = hover === i && it.pickable;
        return (
          <motion.div
            key={it.key}
            className="absolute"
            style={{ width: cardW, left: `calc(50% - ${cardW / 2}px)`, top: 40, transformOrigin: `50% ${cardH / 2 + radius}px`, zIndex: lifted ? 50 : i }}
            initial={{ rotate: jitter[i], y: -30, opacity: 0, scale: 0.92 }}
            animate={{ rotate: spread ? base + push : jitter[i], y: lifted ? -34 : 0, opacity: 1, scale: lifted ? 1.07 : 1 }}
            transition={{
              rotate: { type: "spring", stiffness: 120, damping: 15, delay: spread && hover === null ? i * 0.045 : 0 },
              y: { type: "spring", stiffness: 300, damping: 22 },
              scale: { type: "spring", stiffness: 300, damping: 22 },
              opacity: { duration: 0.3, delay: i * 0.04 },
            }}
            onHoverStart={() => setHover(i)}
            onFocus={() => setHover(i)}
          >
            {it.node}
          </motion.div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */
/** Small icon on the card back, so the kind of card shows without a label. */
const LABEL_ICON: Record<string, typeof Lightbulb> = {
  Organisation: Users, Abläufe: Route, Projekte: Briefcase, "Haushalt & Beschaffung": Wallet, IT: Monitor,
  Aufsicht: Landmark, Kommunikation: MessageCircle, Ungeschriebenes: Feather, Alltag: Coffee,
};
function cardIcon(c: Card) {
  if (c.kind === "open_question") return MessageCircle;
  if (c.kind === "gap") return Puzzle;
  return LABEL_ICON[c.label] ?? Lightbulb;
}

function BackIcon({ icon: Icon }: { icon: typeof Lightbulb }) {
  return (
    <div className="grid place-items-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/55 transition-colors group-hover:border-white/35 group-hover:text-white/90">
        <Icon size={20} strokeWidth={1.6} />
      </span>
    </div>
  );
}

function DeckCard({ c, index, onPick }: { c: Card; index: number; onPick: () => void }) {
  const num = String(c.card).padStart(2, "0");
  return (
    <div className="relative">
    <motion.button
      initial={{ filter: "brightness(1.8) blur(3px)" }}
      animate={{ filter: "brightness(1) blur(0px)" }}
      transition={{ delay: index * 0.06, duration: 0.6, ease: "easeOut" }}
      style={{ ["--shine-delay" as string]: `${index * 0.05 + 1.1}s` }}
      onClick={c.done ? undefined : onPick}
      aria-label={c.done ? `Karte ${num}, beantwortet` : `Karte ${num} ziehen`}
      disabled={c.done}
      className={cx(
        "group relative z-10 flex w-full aspect-[3/4] flex-col justify-between rounded-[14px] p-4 text-left transition-shadow",
        c.done ? "cursor-default border border-line bg-surface shadow-xs" : "card-back card-shine text-white shadow-[0_6px_18px_rgb(0_0_0/0.25)] hover:shadow-pop",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("text-[12px] tabular-nums", c.done ? "text-faint" : "text-white/45")}>{num}</span>
        {c.done && (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      {c.done ? (
        <p className="line-clamp-5 text-[13px] leading-snug text-muted">{c.original}</p>
      ) : (
        <BackIcon icon={cardIcon(c)} />
      )}
      {c.done ? <span className="text-[11.5px] text-faint">Beantwortet</span> : <span />}
    </motion.button>
    </div>
  );
}

function RewardCard({ index, unlocked, remaining, onOpen }: { index: number; unlocked: boolean; remaining: number; onOpen: () => void }) {
  return (
    <div className="relative">
    <motion.button
      initial={{ filter: "brightness(1.8) blur(3px)" }}
      animate={{ filter: "brightness(1) blur(0px)" }}
      transition={{ delay: index * 0.06, duration: 0.6, ease: "easeOut" }}
      style={{ ["--shine-delay" as string]: `${index * 0.05 + 1.1}s` }}
            onClick={unlocked ? onOpen : undefined}
      disabled={!unlocked}
      className={cx("card-reward card-shine relative z-10 flex w-full aspect-[3/4] flex-col justify-between rounded-[14px] p-4 text-left", unlocked ? "ring-1 ring-gold shadow-pop" : "shadow-[0_6px_18px_rgb(0_0_0/0.25)]")}
    >
      <span className="text-[12px] tabular-nums text-gold/70">10</span>
      <div className="space-y-2">
        {unlocked ? <Gift size={20} className="text-gold" /> : <Lock size={18} className="text-gold/60" />}
        <div className="text-[13.5px] font-medium leading-snug text-gold">{unlocked ? "Für dich" : "Letzte Karte"}</div>
      </div>
      <span className="text-[11.5px] text-gold/60">{unlocked ? "Aufdecken" : `Noch ${remaining} Karte${remaining === 1 ? "" : "n"}`}</span>
    </motion.button>
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} style={{ perspective: 1200 }}>
      <motion.div
        initial={{ rotateY: -70, opacity: 0, scale: 0.96 }}
        animate={{ rotateY: 0, opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px]"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

type Phase = "asking" | "record" | "sending" | "done";

function CardDialog({ card, saved, onClose, onAnswered, learnOffline }: { card: Card; saved: Saved; onClose: () => void; onAnswered: (c: Card, n: Note[], s?: IvSession, advance?: boolean) => void; learnOffline: (text: string) => void }) {
  const { user, engineState } = useStore();
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("asking");
  const [result, setResult] = useState<{ notes: Note[]; transcript: string; redacted: number } | null>(null);
  const [err, setErr] = useState("");
  const rec = useRecorder();
  const spoken = useRef("");
  const speech = useSpeech((t) => (spoken.current = t));
  const fileRef = useRef<HTMLInputElement>(null);
  const live = saved.mode === "live" && !!saved.sid;

  useEffect(() => {
    if (live) {
      // the deck already carries Finn's wording: show it at once, tell the backend in passing
      setQuestion(card.text || phraseCard({ ...card, openQuestionId: card.ref }, user.personaId));
      setPhase("record");
      interviewApi.pick(saved.sid!, card.card).catch(() => undefined);
    } else {
      setQuestion(phraseCard({ ...card, openQuestionId: card.ref }, user.personaId));
      setPhase("record");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRec = async () => {
    spoken.current = "";
    await rec.start();
    if (!live && speech.supported) speech.start(); // demo mode: the browser transcribes
  };
  const stopRec = () => {
    rec.stop();
    speech.stop();
  };

  const submit = async (audio: Blob, filename?: string) => {
    setErr("");
    setPhase("sending");
    if (live) {
      try {
        // returns at once; Whisper, redaction and indexing run in the background
        const s = await interviewApi.submitAudio(saved.sid!, card.card, audio, filename);
        onAnswered(card, [], s, true);
      } catch {
        setErr("Die Aufnahme konnte nicht gesendet werden. Versuch es bitte noch einmal.");
        setPhase("record");
        rec.reset();
      }
      return;
    }
    // demo mode: browser speech recognition, or the presenter's prepared answer for uploads
    await new Promise((r) => setTimeout(r, 900));
    const raw = (filename ? "" : spoken.current.trim()) || card.demoAnswer || spoken.current.trim();
    if (!raw) {
      setErr("Ich habe nichts gehört. Versuch es bitte noch einmal.");
      setPhase("record");
      rec.reset();
      return;
    }
    const r = processAnswer(raw, engineState);
    const notes = r.statements.map((s) => ({ card: card.card, section: s.section, text: s.text }));
    if ((card.kind === "open_question" || card.kind === "gap") && (notes.length || !r.ignored)) {
      learnOffline(r.ignored ? notes.map((n) => n.text).join(" ") : r.clean);
    }
    setResult({ notes, transcript: r.clean, redacted: r.redacted });
    onAnswered(card, notes);
    setPhase("done");
  };

  const [typed, setTyped] = useState("");
  const submitText = async () => {
    const text = typed.trim();
    if (text.length < 2) return;
    setErr("");
    setPhase("sending");
    if (live) {
      try {
        // returns at once; redaction, extraction and indexing run in the background
        const s = await interviewApi.submit(saved.sid!, card.card, text);
        onAnswered(card, [], s, true);
      } catch (e) {
        setErr(`Die Antwort konnte nicht gespeichert werden (${e instanceof Error ? e.message : "Fehler"}). Bitte noch einmal senden.`);
        setPhase("record");
      }
      return;
    }
    const r = processAnswer(text, engineState);
    const notes = r.statements.map((s) => ({ card: card.card, section: s.section, text: s.text }));
    if ((card.kind === "open_question" || card.kind === "gap") && (notes.length || !r.ignored)) {
      learnOffline(r.ignored ? notes.map((n) => n.text).join(" ") : r.clean);
    }
    setResult({ notes, transcript: r.clean, redacted: r.redacted });
    onAnswered(card, notes);
    setPhase("done");
  };

  const asker = card.askedBy ? personaById(card.askedBy) : undefined;

  return (
    <Overlay onClose={phase === "sending" ? () => undefined : onClose}>
      <div className="overflow-hidden rounded-[16px] bg-surface shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-6 py-3.5 text-[12.5px] text-muted">
          <span>
            Karte {String(card.card).padStart(2, "0")} · {card.label}
            {asker && ` · von ${asker.name}`}
          </span>
          {phase !== "sending" && (
            <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md hover:bg-subtle" aria-label="Schließen">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="px-6 pb-6 pt-5">
          {phase === "asking" ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
              <Spinner /> Finn formuliert die Frage …
            </div>
          ) : (
            <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.01em]">{question}</h3>
          )}

          {phase === "record" && (
            <div className="mt-7">
              {rec.state === "recorded" && rec.blob ? (
                <Recorded blob={rec.blob} seconds={rec.seconds} onRetry={rec.reset} onSend={() => submit(rec.blob!)} />
              ) : (
                <div className="flex items-center gap-4">
                  <button
                    onClick={rec.state === "recording" ? stopRec : startRec}
                    className={cx("grid h-14 w-14 shrink-0 place-items-center rounded-full text-white transition-colors", rec.state === "recording" ? "bg-danger" : "bg-ink hover:bg-ink-2")}
                    aria-label={rec.state === "recording" ? "Aufnahme beenden" : "Aufnahme starten"}
                  >
                    {rec.state === "recording" ? <Square size={16} fill="currentColor" /> : <Mic size={20} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    {rec.state === "recording" ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[14px] font-medium tabular-nums">{mmss(rec.seconds)}</span>
                        <Level level={rec.level} />
                      </div>
                    ) : (
                      <div className="text-[14px] font-medium">Antwort aufnehmen</div>
                    )}
                    <button onClick={() => fileRef.current?.click()} className="mt-1 flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" disabled={rec.state === "recording"}>
                      <Upload size={12} /> oder Audiodatei hochladen
                    </button>
                  </div>
                </div>
              )}
              {rec.state !== "recording" && rec.state !== "recorded" && (
                <div className="mt-5">
                  <div className="mb-1.5 text-[12px] text-faint">oder Antwort tippen</div>
                  <textarea
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        submitText();
                      }
                    }}
                    rows={3}
                    placeholder="Deine Antwort …"
                    className="w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-ink/40"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" disabled={typed.trim().length < 2} onClick={submitText}>
                      Antwort senden
                    </Button>
                  </div>
                </div>
              )}
              {(err || rec.error) && <p className="mt-4 text-[12.5px] text-danger">{err || rec.error}</p>}
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) submit(f, f.name);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {phase === "sending" && (
            <div className="mt-7 flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> Finn hört zu und schreibt mit …
            </div>
          )}

          {phase === "done" && result && (
            <div className="mt-6">
              {result.notes.length > 0 ? (
                <>
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-faint">Notiert fürs Handbuch</div>
                  <ul className="space-y-2">
                    {result.notes.map((n, i) => (
                      <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed">
                        <Check size={15} className="mt-[3px] shrink-0 text-accent" />
                        {n.text}
                      </li>
                    ))}
                  </ul>
                  {live && <p className="mt-3 text-[12.5px] text-accent">Gespeichert – Finn kann ab sofort daraus antworten.</p>}
                </>
              ) : (
                <p className="text-[13.5px] text-muted">Danke! Für diese Karte gab es nichts Neues fürs Handbuch.</p>
              )}
              <details className="mt-5 text-[12.5px] text-muted">
                <summary className="cursor-pointer select-none hover:text-ink">
                  Transkript{result.redacted > 0 && ` · ${result.redacted} Steuerdetail${result.redacted > 1 ? "s" : ""} geschwärzt`}
                </summary>
                <p className="mt-2 leading-relaxed text-ink-2">
                  {result.transcript.split(/(\[[^\]]+\])/).map((x, i) =>
                    /^\[[^\]]+\]$/.test(x) ? <span key={i} className="mx-0.5 inline-block h-[1.05em] w-16 translate-y-[2px] rounded-sm bg-ink" title="Geschwärzt (§ 30 AO)" /> : <span key={i}>{x}</span>,
                  )}
                </p>
              </details>
              <div className="mt-6 flex justify-end">
                <Button onClick={onClose}>Fertig</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function Level({ level }: { level: number }) {
  return (
    <span className="flex h-6 items-center gap-[3px]">
      {Array.from({ length: 18 }).map((_, i) => {
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
        Antwort senden
      </Button>
    </div>
  );
}

function RewardDialog({ name, years, voucher, onClose }: { name: string; years: number; voucher?: Voucher; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="card-reward overflow-hidden rounded-[18px] p-8 text-white shadow-pop">
        <div className="flex items-center justify-between text-[12px] text-gold/70">
          <span>Karte 10</span>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-gold/70 hover:bg-white/5" aria-label="Schließen">
            <X size={15} />
          </button>
        </div>
        <Gift size={26} className="mt-8 text-gold" />
        <h3 className="mt-4 text-[24px] font-semibold tracking-[-0.01em]">Danke, {name}.</h3>
        <p className="mt-1.5 text-[14px] text-white/60">{years} Jahre Wissen – und jetzt bleibt es im Amt.</p>
        {voucher ? (
          <div className="mt-8 rounded-[12px] border border-gold/30 p-5">
            <div className="text-[12px] uppercase tracking-[0.08em] text-gold/80">Gutschein</div>
            <div className="mt-1.5 text-[18px] font-semibold text-gold">{voucher.title_de}</div>
            <div className="mt-1 text-[13.5px] leading-relaxed text-white/70">{voucher.detail_de}</div>
            <div className="mt-4 flex items-center justify-between text-[12.5px] text-white/50">
              <span>Weil du gern: {voucher.based_on}</span>
              <span className="tabular-nums">ca. {voucher.est_eur} €</span>
            </div>
          </div>
        ) : (
          <p className="mt-8 text-[13.5px] text-white/60">Dein Team überrascht dich bei der Verabschiedung.</p>
        )}
      </div>
    </Overlay>
  );
}
