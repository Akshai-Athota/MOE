import { motion } from "framer-motion";
import { AlertTriangle, ArrowUp, CalendarClock, Check, History, Lock, Mic, MicOff, Phone, Sparkles, UserRoundSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CitationChip, SourceDrawer } from "../components/Sources";
import { Avatar, Badge, Card, QLogo, cx } from "../components/ui";
import { DATA, ROLE_LABEL, canSee, fmtDate, personaById } from "../lib/data";
import { useStore } from "../lib/store";
import type { Answer, ChatMessage, Citation, Fact, Role } from "../lib/types";
import { useSpeech } from "../lib/useSpeech";

const SUGGESTIONS: Record<Role, string[]> = {
  new_hire: [
    "Wer zeichnet meine Bescheide in den ersten Monaten?",
    "Wo kann ich parken?",
    "Wann hat die Kantine geöffnet?",
    "Wie läuft die Haushaltsanmeldung?",
    "Darf ich ins Homeoffice?",
    "Welche ungeschriebenen Regeln gibt es?",
  ],
  employee: ["Wo kann ich parken?", "Gibt es ein Jobticket?", "Wie ist das Budget aufgeteilt?", "Wer sind die Ersthelfer?", "Wen rufe ich bei IT-Problemen an?"],
  leaver: ["Was darf ein Abschiedsgeschenk kosten?", "Wer vertritt mich?", "Wo kann ich parken?", "Wie funktioniert das Mitzeichnungsverfahren?"],
  manager: ["Wie ist das Budget aufgeteilt?", "Wann ist der Verwendungsnachweis fällig?", "Wer gibt Pressemitteilungen frei?", "Wie ist der Stand der Nachfolge in der Geschäftsstelle?"],
};

function AnswerBody({ a, onCite }: { a: Answer; onCite: (f: Fact, c: Citation) => void }) {
  if (a.kind === "blocked")
    return (
      <div className="flex gap-3 rounded-2xl bg-rose-50 p-3.5 ring-1 ring-rose-100">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-rose-500">
          <Lock size={17} />
        </div>
        <div className="text-[13px] text-rose-700">
          <div className="font-bold">Für deine Rolle gesperrt</div>
          Die Rechteprüfung passiert vor der Suche – Q bekommt diese Inhalte gar nicht erst zu sehen.
        </div>
      </div>
    );
  if (a.kind === "gap" && a.askPerson)
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-canvas p-3">
          <Avatar p={a.askPerson} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold">{a.askPerson.name}</div>
            <div className="truncate text-[12px] text-muted">{a.askPerson.role_de}</div>
          </div>
          <a className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[12px] font-semibold text-brand-700 shadow-soft" href="#" onClick={(e) => e.preventDefault()}>
            <Phone size={13} /> {a.askPerson.phone_ext}
          </a>
        </div>
        {a.queued && (
          <div className="flex items-center gap-2 text-[12px] font-medium text-mint-700">
            <Check size={14} /> Frage an {a.askPerson.name.split(" ")[0]} weitergeleitet – kommt ins nächste Wissensinterview
          </div>
        )}
      </div>
    );
  if (a.kind === "conflict")
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {a.facts.map((f, i) => (
          <div key={f.id} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">Quelle {i + 1}</div>
            <p className="mb-2 text-[13px] leading-relaxed">{f.de}</p>
            <CitationChip c={a.citations[i]} onClick={() => onCite(f, a.citations[i])} />
          </div>
        ))}
      </div>
    );
  return (
    <div className="space-y-2.5">
      {a.changedFrom && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700 ring-1 ring-amber-100">
          <History size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Geändert am {fmtDate(a.facts[0].valid_from)}.</b> Vorher: <span className="line-through decoration-amber-700/40">{a.changedFrom.de}</span>
          </span>
        </div>
      )}
      {a.upcoming && (
        <div className="flex items-start gap-2 rounded-2xl bg-sky-50 px-3 py-2.5 text-[12px] text-ink ring-1 ring-sky-50">
          <CalendarClock size={14} className="mt-0.5 shrink-0 text-sky-500" />
          <span>
            <b className="text-sky-500">Ab {fmtDate(a.upcoming.valid_from)}:</b> {a.upcoming.de}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {a.citations.map((c, i) => (
          <CitationChip key={c.factId} c={c} n={i + 1} onClick={() => onCite(a.facts[i], c)} />
        ))}
      </div>
    </div>
  );
}

function Typing({ slow }: { slow?: boolean }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3.5 shadow-soft">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-2 w-2 rounded-full bg-brand-400" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} />
      ))}
      {slow && <span className="ml-2 text-[12px] text-muted">Q durchsucht die Quellen …</span>}
    </div>
  );
}

function QMessage({ m, onCite, fresh }: { m: ChatMessage; onCite: (f: Fact, c: Citation) => void; fresh: boolean }) {
  const [shown, setShown] = useState(!fresh);
  useEffect(() => {
    if (shown) return;
    const t = setTimeout(() => setShown(true), 750);
    return () => clearTimeout(t);
  }, [shown]);
  if (m.pending || !m.answer)
    return (
      <div className="flex gap-3">
        <QLogo size={34} />
        <Typing slow />
      </div>
    );
  const a = m.answer;
  const head =
    a.kind === "conflict" ? (
      <Badge tone="amber" icon={<AlertTriangle size={11} />}>Widersprüchliche Quellen</Badge>
    ) : a.kind === "gap" ? (
      <Badge tone="coral" icon={<UserRoundSearch size={11} />}>Wissenslücke</Badge>
    ) : a.kind === "blocked" ? (
      <Badge tone="rose" icon={<Lock size={11} />}>Zugriff geschützt</Badge>
    ) : a.facts.some((f) => f.learned) ? (
      <Badge tone="mint" icon={<Sparkles size={11} />}>Neu gelernt</Badge>
    ) : null;
  return (
    <div className="flex gap-3">
      <QLogo size={34} />
      <div className="min-w-0 max-w-[680px] flex-1">
        {!shown && m.source !== "live" ? (
          <Typing />
        ) : (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl rounded-tl-md border border-line bg-white p-4 shadow-soft">
            {head && <div className="mb-2">{head}</div>}
            <p className="mb-3 text-[14.5px] leading-relaxed">{m.text}</p>
            <AnswerBody a={a} onCite={onCite} />
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function AskView() {
  const { user, chats, askQ, draft, setDraft, engineState, backend } = useStore();
  const me = personaById(user.personaId)!;
  const msgs = chats[user.personaId] ?? [];
  const [text, setText] = useState("");
  const [src, setSrc] = useState<{ f: Fact; c: Citation }>();
  const endRef = useRef<HTMLDivElement>(null);
  const initialCount = useRef(msgs.length);
  const speech = useSpeech((t) => setText(t));

  useEffect(() => {
    if (draft) {
      askQ(draft);
      setDraft("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const send = (t = text) => {
    if (!t.trim()) return;
    speech.stop();
    askQ(t.trim());
    setText("");
  };

  const access = useMemo(() => {
    const all = [...DATA.facts, ...engineState.learned].filter((f) => f.status !== "superseded");
    const vis = all.filter((f) => canSee(user.role, me.department, f)).length;
    return { vis, total: all.length };
  }, [user.role, me.department, engineState.learned]);

  return (
    <div className="flex h-full min-h-[600px] flex-col">
      <PageHeader
        eyebrow="Frag Q"
        title={`Hallo ${me.name.replace("Dr. ", "").split(" ")[0]}, was möchtest du wissen?`}
        sub="Q antwortet nur aus geprüften Quellen, zeigt immer woher die Antwort kommt – und sagt ehrlich, wenn sie etwas nicht weiß."
        right={
          <div className="flex flex-wrap items-center gap-2">
          <div
            title={backend === "live" ? "Antworten kommen aus dem RAG-Backend (Qdrant + lokales LLM)" : "Backend nicht erreichbar – Antworten aus der Demo-Engine im Browser"}
            className={cx(
              "flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[12px] font-semibold ring-1",
              backend === "live" ? "bg-mint-50 text-mint-700 ring-mint-100" : "bg-amber-50 text-amber-700 ring-amber-100",
            )}
          >
            <span className={cx("h-2 w-2 rounded-full", backend === "live" ? "bg-mint-500" : backend === "checking" ? "bg-amber-300" : "bg-amber-500")} />
            {backend === "live" ? "Live · RAG-Backend" : backend === "checking" ? "Verbinde …" : "Demo-Modus"}
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-white px-3.5 py-2 text-[12px] shadow-soft">
            <Lock size={13} className="text-brand-500" />
            <span className="text-muted">Rolle:</span>
            <b>{ROLE_LABEL[user.role]}</b>
            <span className="text-muted">·</span>
            <span className="text-muted">
              {access.vis}/{access.total} Wissenseinträge sichtbar
            </span>
          </div>
          </div>
        }
      />

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 lg:px-8">
        {msgs.length === 0 ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center pb-6 pt-6 text-center">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
              <QLogo size={84} glow />
            </motion.div>
            <h2 className="mt-5 text-xl font-extrabold">Ich bin Q, eure KI-Kollegin.</h2>
            <p className="mt-1.5 max-w-md text-[14px] text-muted">
              Ich kenne Abläufe, Regeln und das Wissen erfahrener Kolleg:innen. Ich bin eine KI – deshalb zeige ich dir immer meine Quellen.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS[user.role].map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-2xl border border-line bg-white px-3.5 py-2 text-[13px] font-medium shadow-soft transition hover:-translate-y-0.5 hover:border-brand-200 hover:text-brand-700">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) =>
            m.from === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[560px] rounded-3xl rounded-tr-md bg-brand-500 px-4 py-3 text-[14.5px] text-white shadow-glow">{m.text}</div>
              </div>
            ) : (
              <QMessage key={m.id} m={m} fresh={i >= initialCount.current} onCite={(f, c) => setSrc({ f, c })} />
            ),
          )
        )}
        <div ref={endRef} className="h-2" />
      </div>

      <div className="px-5 pb-5 pt-3 lg:px-8 lg:pb-7">
        {msgs.length > 0 && (
          <div className="scroll-thin mb-2.5 flex gap-2 overflow-x-auto pb-1">
            {SUGGESTIONS[user.role].map((s) => (
              <button key={s} onClick={() => send(s)} className="shrink-0 rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-muted ring-1 ring-line hover:text-brand-700 hover:ring-brand-200">
                {s}
              </button>
            ))}
          </div>
        )}
        <Card className="flex items-end gap-2 rounded-[26px] p-2 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
          {speech.supported && (
            <button
              onClick={speech.listening ? speech.stop : speech.start}
              className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition", speech.listening ? "bg-coral-500 text-white" : "bg-canvas text-muted hover:text-brand-600")}
              aria-label="Spracheingabe"
            >
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={speech.listening ? "Ich höre zu …" : "Frag Q etwas – z. B. „Wo kann ich parken?“"}
            className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-muted/70"
          />
          <button
            onClick={() => send()}
            disabled={!text.trim()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500 text-white shadow-glow transition hover:bg-brand-600 disabled:bg-brand-200 disabled:shadow-none"
            aria-label="Senden"
          >
            <ArrowUp size={19} />
          </button>
        </Card>
        <div className="mt-2 text-center text-[11px] text-muted">Q ist eine KI. Antworten mit Quelle prüfen · keine Auskünfte zu einzelnen Steuerfällen</div>
      </div>

      <SourceDrawer fact={src?.f} citation={src?.c} onClose={() => setSrc(undefined)} />
    </div>
  );
}
