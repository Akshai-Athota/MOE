import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DATA, DEMO_USERS, TODAY, personaById } from "./data";
import { ask as engineAsk, guessCategory, redactedString, type EngineState } from "./engine";
import type { ChatMessage, Fact, KnowledgeEvent, OpenQuestion, Role } from "./types";

export type View = "ask" | "onboarding" | "interview" | "celebration" | "memory" | "coverage";

export const VIEWS_BY_ROLE: Record<Role, View[]> = {
  new_hire: ["onboarding", "ask"],
  leaver: ["interview", "celebration", "ask"],
  employee: ["ask"],
  manager: ["coverage", "memory", "celebration", "ask"],
};

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "brand" | "mint" | "coral" | "amber";
}

interface Persisted {
  learned: Fact[];
  supersededAtRuntime: string[];
  resolved: Record<string, string>;
  openQuestions: OpenQuestion[];
  events: KnowledgeEvent[];
  checks: Record<string, boolean>;
  chats: Record<string, ChatMessage[]>;
}

const KEY = "q-demo-v1";

function seedEvents(): KnowledgeEvent[] {
  const ev: KnowledgeEvent[] = [];
  for (const s of DATA.plants.superseded) {
    const n = DATA.facts.find((f) => f.id === s.new)!;
    ev.push({ id: `seed-${s.new}`, at: n.valid_from, kind: "UPDATE", title: n.topic.replace(" (neu)", ""), detail: s.demo, source: n.rule ?? "Dokument" });
  }
  for (const c of DATA.plants.conflicts) {
    const f = DATA.facts.find((x) => x.id === c.facts[1])!;
    ev.push({ id: `seed-c-${c.question}`, at: f.valid_from, kind: "CONFLICT", title: f.topic.replace(/ \(.*\)/, ""), detail: "Zwei Quellen widersprechen sich – Klärung durch Führungskraft nötig.", source: c.facts.join(" ↔ ") });
  }
  ev.push({ id: "seed-int", at: "2026-11-12", kind: "NEW", title: "Übergabeinterview W. Reinecke (Teil 1)", detail: "14 Aussagen extrahiert, 1 Steuerpflichtige:r automatisch geschwärzt.", source: "Interview p05" });
  ev.push({ id: "seed-same", at: "2026-11-14", kind: "SAME", title: "Vertretungsplan bestätigt", detail: "Interview H.-J. Meyer bestätigt Vertretungsregeln – Quelle ergänzt, Datum aktualisiert.", source: "Interview p11" });
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

function seed(): Persisted {
  return {
    learned: [],
    supersededAtRuntime: [],
    resolved: {},
    openQuestions: [
      { id: "oq-1", text: "Wie läuft eigentlich die Haushaltsanmeldung fürs nächste Jahr?", askedBy: "p13", askedAt: "2026-11-19", routedTo: "p05", gapId: "Q34" },
      { id: "oq-2", text: "Gibt es Ladesäulen für E-Autos?", askedBy: "p04", askedAt: "2026-11-18", routedTo: "p05", gapId: "G14" },
      { id: "oq-3", text: "Welche Rentenfälle sollte ich nicht alleine bearbeiten?", askedBy: "p13", askedAt: "2026-11-20", routedTo: "p11", gapId: "X04" },
    ],
    events: seedEvents(),
    checks: {},
    chats: {},
  };
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: run in memory */
  }
  return seed();
}

export interface LearnInput {
  text: string;
  owner: string;
  via: "interview" | "quiz" | "upload";
  label: string;
  gapId?: string;
  questionIds?: string[];
  supersedes?: string;
  validFrom?: string;
  topic?: string;
}

interface Store extends Persisted {
  userIdx: number;
  user: { personaId: string; role: Role };
  view: View;
  draft: string;
  toasts: Toast[];
  engineState: EngineState;
  setUserIdx: (i: number) => void;
  setView: (v: View) => void;
  setDraft: (d: string) => void;
  askQ: (text: string) => void;
  learn: (i: LearnInput) => Fact;
  resolveConflict: (question: string, truth: string) => void;
  toggleCheck: (k: string) => void;
  toast: (t: Omit<Toast, "id">) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Persisted>(load);
  const [userIdx, setUserIdxRaw] = useState(0);
  const [view, setView] = useState<View>("onboarding");
  const [draft, setDraft] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const user = DEMO_USERS[userIdx];

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, [p]);

  const engineState: EngineState = useMemo(
    () => ({ learned: p.learned, supersededAtRuntime: p.supersededAtRuntime, resolved: p.resolved }),
    [p.learned, p.supersededAtRuntime, p.resolved],
  );

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 4200);
  }, []);

  const setUserIdx = (i: number) => {
    setUserIdxRaw(i);
    setView(VIEWS_BY_ROLE[DEMO_USERS[i].role][0]);
  };

  const askQ = (text: string) => {
    const answer = engineAsk(text, user.role, user.personaId, engineState);
    const msgs: ChatMessage[] = [
      { id: crypto.randomUUID(), from: "user", text },
      { id: crypto.randomUUID(), from: "q", text: answer.text, answer },
    ];
    setP((s) => {
      let openQuestions = s.openQuestions;
      if (answer.kind === "gap" && answer.askPerson && !s.openQuestions.some((q) => !q.resolved && ((answer.gapId && q.gapId === answer.gapId) || q.text === text))) {
        openQuestions = [
          { id: crypto.randomUUID(), text, askedBy: user.personaId, askedAt: TODAY, routedTo: answer.askPerson.id, gapId: answer.gapId },
          ...s.openQuestions,
        ];
      }
      return { ...s, openQuestions, chats: { ...s.chats, [user.personaId]: [...(s.chats[user.personaId] ?? []), ...msgs] } };
    });
  };

  const learn = (i: LearnInput): Fact => {
    const clean = redactedString(i.text);
    const id = `L${String(p.learned.length + 1).padStart(3, "0")}`;
    const gapQ = i.gapId ? [i.gapId] : [];
    const fact: Fact = {
      id,
      category: guessCategory(clean),
      topic: i.topic ?? clean.split(/[.:–]/)[0].slice(0, 60),
      de: clean,
      en: "",
      owner: i.owner,
      department: personaById(i.owner)?.department ?? "ALL",
      access: "internal",
      valid_from: i.validFrom ?? TODAY,
      status: "current",
      supersedes: i.supersedes ?? null,
      question_ids: [...gapQ, ...(i.questionIds ?? [])],
      sources_planned: [i.via === "upload" ? "doc" : "interview"],
      learned: { label: i.label, at: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), via: i.via },
    };
    setP((s) => ({
      ...s,
      learned: [...s.learned, fact],
      supersededAtRuntime: i.supersedes && (i.validFrom ?? TODAY) <= TODAY ? [...s.supersededAtRuntime, i.supersedes] : s.supersededAtRuntime,
      openQuestions: s.openQuestions.map((q) => (i.gapId && q.gapId === i.gapId ? { ...q, resolved: true } : q)),
      events: [
        {
          id: crypto.randomUUID(),
          at: TODAY,
          kind: i.supersedes ? "UPDATE" : "NEW",
          title: fact.topic,
          detail: i.supersedes ? `Ersetzt ${i.supersedes} ab ${i.validFrom}` : `Neue Aussage aufgenommen${i.gapId ? " – Wissenslücke geschlossen" : ""}.`,
          source: i.label,
        },
        ...s.events,
      ],
    }));
    return fact;
  };

  const resolveConflict = (question: string, truth: string) => {
    const f = DATA.facts.find((x) => x.id === truth);
    setP((s) => ({
      ...s,
      resolved: { ...s.resolved, [question]: truth },
      events: [{ id: crypto.randomUUID(), at: TODAY, kind: "RESOLVED", title: f?.topic.replace(/ \(.*\)/, "") ?? truth, detail: `Entschieden: ${truth} gilt.`, source: "Freigabe Führungskraft" }, ...s.events],
    }));
  };

  const toggleCheck = (k: string) => setP((s) => ({ ...s, checks: { ...s.checks, [k]: !s.checks[k] } }));

  const reset = () => {
    setP(seed());
    toast({ title: "Demo zurückgesetzt", tone: "brand" });
  };

  return (
    <Ctx.Provider
      value={{ ...p, userIdx, user, view, draft, toasts, engineState, setUserIdx, setView, setDraft, askQ, learn, resolveConflict, toggleCheck, toast, reset }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}
