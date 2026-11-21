import { ArrowUp, Lock, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SourceLink, SourceSheet } from "../components/Sources";
import { motion } from "framer-motion";
import { FinnAvatar, Reveal } from "../components/motion";
import { Avatar, cx } from "../components/ui";
import { firstName, fmtDate, personaById } from "../lib/data";
import { useStore } from "../lib/store";
import type { Answer, ChatMessage, Citation, Fact, Role } from "../lib/types";
import { useSpeech } from "../lib/useSpeech";

const SUGGESTIONS: Record<Role, string[]> = {
  new_hire: ["Wer zeichnet meine Bescheide in den ersten Monaten?", "Funktioniert der Drucker im 2. OG?", "Wie läuft die Haushaltsanmeldung?", "Wie ist das Budget aufgeteilt?"],
  leaver: ["Wer vertritt mich?", "Was darf ein Abschiedsgeschenk kosten?", "Wo kann ich parken?"],
  employee: ["Wo kann ich parken?", "Gibt es ein Jobticket?", "Wann geht die E-Akte live?", "Wie ist das Budget aufgeteilt?"],
  manager: ["Wie ist das Budget aufgeteilt?", "Wie steht die Dienstvereinbarung KI?", "Wer übernimmt die Geschäftsstelle nach Herrn Reinecke?", "Wie viele Stellen fehlen im Arbeitnehmerbereich?"],
};

function AnswerExtras({ a, onCite }: { a: Answer; onCite: (f: Fact, c: Citation) => void }) {
  if (a.kind === "blocked")
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
        <Lock size={12} /> Für deine Rolle nicht freigegeben.
      </p>
    );
  if (a.kind === "gap" && a.askPerson)
    return (
      <div className="mt-3 flex items-center gap-2.5 text-[12.5px] text-muted">
        <Avatar p={a.askPerson} size={22} />
        <span>
          Weitergeleitet an <span className="text-ink">{a.askPerson.name}</span> · {a.askPerson.phone_ext}
        </span>
      </div>
    );
  return (
    <>
      {a.changedFrom && (
        <p className="mt-2 text-[12.5px] text-warn">
          Geändert am {fmtDate(a.facts[0]?.valid_from)}. Vorher: {a.changedFrom.de}
        </p>
      )}
      {a.upcoming && <p className="mt-2 text-[12.5px] text-warn">Ab {fmtDate(a.upcoming.valid_from)}: {a.upcoming.de}</p>}
      {a.kind === "conflict" && (
        <div className="mt-3 space-y-2">
          {a.facts.map((f) => (
            <div key={f.id} className="border-l-2 border-line-strong pl-3 text-[13px] text-ink-2">
              {f.de}
            </div>
          ))}
        </div>
      )}
      {a.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.citations.map((c, i) => (
            <SourceLink key={c.factId + i} c={c} n={i + 1} onClick={() => onCite(a.facts[i], c)} />
          ))}
        </div>
      )}
    </>
  );
}

function Message({ m, onCite }: { m: ChatMessage; onCite: (f: Fact, c: Citation) => void }) {
  if (m.from === "user")
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="flex justify-end">
        <div className="max-w-[80%] rounded-[12px] bg-subtle px-3.5 py-2.5 text-[14px] leading-relaxed">{m.text}</div>
      </motion.div>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="flex gap-3">
      <FinnAvatar size={24} mood={m.pending ? "thinking" : "idle"} />
      <div className="min-w-0 flex-1 pt-0.5">
        {m.pending ? (
          <span className="inline-block py-1 text-[13px] text-faint">Finn denkt nach …</span>
        ) : (
          <motion.div initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.45 }}>
            <p className="text-[14px] leading-relaxed text-ink">{m.text}</p>
            {m.answer && <AnswerExtras a={m.answer} onCite={onCite} />}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default function AskView() {
  const { user, chats, ask, draft, setDraft } = useStore();
  const me = personaById(user.personaId)!;
  const msgs = chats[user.personaId] ?? [];
  const [text, setText] = useState("");
  const [src, setSrc] = useState<{ f: Fact; c: Citation }>();
  const endRef = useRef<HTMLDivElement>(null);
  const speech = useSpeech((t) => setText(t));

  useEffect(() => {
    if (draft) {
      ask(draft);
      setDraft("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, msgs[msgs.length - 1]?.pending]);

  const send = (t = text) => {
    if (!t.trim()) return;
    speech.stop();
    ask(t.trim());
    setText("");
  };

  return (
    <div className="mx-auto flex h-full min-h-[calc(100vh-56px)] max-w-[760px] flex-col px-5 lg:min-h-screen">
      <div className="flex-1 space-y-6 pb-6 pt-10">
        {msgs.length === 0 ? (
          <div className="pt-[12vh]">
            <Reveal>
              <FinnAvatar size={40} />
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.01em]">Hallo {firstName(me)}, was möchtest du wissen?</h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-1.5 text-[14px] text-muted">Finn antwortet aus geprüften Quellen und sagt dir, wenn er etwas nicht weiß.</p>
            </Reveal>
            <div className="mt-8 divide-y divide-line border-y border-line">
              {SUGGESTIONS[user.role].map((s, i) => (
                <Reveal key={s} delay={0.18 + i * 0.05}>
                  <button onClick={() => send(s)} className="block w-full py-3 text-left text-[14px] text-ink-2 transition-colors hover:text-accent">
                    {s}
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) => <Message key={m.id} m={m} onCite={(f, c) => setSrc({ f, c })} />)
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-bg pb-5 pt-2 lg:pb-8">
        <div className="flex items-end gap-1.5 rounded-[12px] border border-line bg-surface p-1.5 shadow-xs focus-within:border-line-strong">
          {speech.supported && (
            <button
              onClick={speech.listening ? speech.stop : speech.start}
              className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-[9px] transition-colors", speech.listening ? "bg-danger text-white" : "text-muted hover:bg-subtle hover:text-ink")}
              aria-label="Spracheingabe"
            >
              {speech.listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
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
            placeholder="Frag Finn …"
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] outline-none placeholder:text-faint"
          />
          <button
            onClick={() => send()}
            disabled={!text.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-ink text-white transition-opacity disabled:opacity-25"
            aria-label="Senden"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11.5px] text-faint">Finn ist eine KI. Keine Auskünfte zu einzelnen Steuerfällen.</p>
      </div>

      <SourceSheet fact={src?.f} citation={src?.c} onClose={() => setSrc(undefined)} />
    </div>
  );
}
