import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_USERS, TODAY, personaById } from "./data";
import { askBackend, checkBackend, learnBackend, libraryApi, resetBackend, type BackendMode } from "./api";
import { ask as engineAsk, guessCategory, redactedString, type EngineState } from "./engine";
import type { Answer, ChatMessage, Fact, LibraryPost, OpenQuestion, Role } from "./types";

export type View = "start" | "ask" | "interview" | "library" | "avatar";

export const VIEWS_BY_ROLE: Record<Role, View[]> = {
  new_hire: ["start", "ask", "library", "avatar"],
  leaver: ["interview", "ask", "library", "avatar"],
  employee: ["ask", "library", "avatar"],
  manager: ["ask", "library", "avatar"],
};

interface Toast {
  id: number;
  title: string;
  body?: string;
}

interface Persisted {
  learned: Fact[];
  supersededAtRuntime: string[];
  resolved: Record<string, string>;
  openQuestions: OpenQuestion[];
  checks: Record<string, boolean>;
  chats: Record<string, ChatMessage[]>;
  /** library posts in demo mode (live mode reads them from the backend) */
  posts: LibraryPost[];
}

const KEY = "finn-demo-v1";
export const INTERVIEW_KEY = "finn-interview-";

function libraryFact(p: LibraryPost): Fact {
  return {
    id: p.factId!,
    category: p.category,
    topic: p.text.split(/[.!?]/)[0].slice(0, 60),
    de: p.text,
    en: "",
    owner: p.user_id,
    department: "ALL",
    access: "internal",
    valid_from: p.created.slice(0, 10),
    status: "current",
    question_ids: [],
    sources_planned: ["doc"],
    learned: { label: `Wissensbibliothek · ${p.author}`, at: p.created, via: "library" },
  };
}

const SEED_POSTS: LibraryPost[] = [
  { id: "lib-1", factId: "LB01", user_id: "p09", author: "Nils Ahrens", category: "it", created: "2026-11-20T08:12:00", text: "Der Drucker im 2. OG neben Raum 2.20 ist defekt. Der Techniker kommt am Donnerstag – bis dahin bitte den Drucker im 1. OG nutzen." },
  { id: "lib-2", factId: "LB02", user_id: "p07", author: "Marco Lindner", category: "it", created: "2026-11-19T15:40:00", text: "Freitag ab 16 Uhr wird Teams aktualisiert. Danach einmal ab- und wieder anmelden, sonst fehlen die Kanäle." },
  { id: "lib-3", factId: "LB03", user_id: "p06", author: "Sabine Krüger", category: "general", created: "2026-11-18T10:05:00", text: "Die Kaffeemaschine im 1. OG ist repariert und entkalkt." },
];

function seed(): Persisted {
  return {
    learned: SEED_POSTS.map(libraryFact),
    supersededAtRuntime: [],
    resolved: {},
    openQuestions: [
      { id: "oq-1", text: "Wie läuft eigentlich die Haushaltsanmeldung fürs nächste Jahr?", askedBy: "p13", askedAt: "2026-11-19", routedTo: "p05", gapId: "Q34" },
      { id: "oq-2", text: "Gibt es Ladesäulen für E-Autos?", askedBy: "p04", askedAt: "2026-11-18", routedTo: "p05", gapId: "G14" },
    ],
    checks: {},
    chats: {},
    posts: SEED_POSTS,
  };
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...seed(), ...JSON.parse(raw) } as Persisted;
      for (const k of Object.keys(saved.chats)) saved.chats[k] = saved.chats[k].filter((m) => !m.pending);
      return saved;
    }
  } catch {
    /* storage unavailable: run in memory */
  }
  return seed();
}

export interface LearnInput {
  text: string;
  owner: string;
  via: "interview" | "upload" | "library";
  label: string;
  gapId?: string;
  topic?: string;
  category?: string;
  /** also index in the backend (false when the backend already did it) */
  sync?: boolean;
}

interface Store extends Persisted {
  userIdx: number;
  user: { personaId: string; role: Role };
  view: View;
  draft: string;
  toasts: Toast[];
  engineState: EngineState;
  backend: BackendMode;
  libraryPosts: LibraryPost[];
  setUserIdx: (i: number) => void;
  setView: (v: View) => void;
  setDraft: (d: string) => void;
  ask: (text: string) => void;
  learn: (i: LearnInput) => Fact;
  resolveOpenQuestion: (id: string) => void;
  addPost: (text: string, category: string, file?: File) => Promise<void>;
  resolvePost: (id: string) => Promise<void>;
  refreshLibrary: () => void;
  toggleCheck: (k: string) => void;
  toast: (t: Omit<Toast, "id">) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Persisted>(load);
  const [userIdx, setUserIdxRaw] = useState(0);
  const [view, setView] = useState<View>("start");
  const [draft, setDraft] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [backend, setBackend] = useState<BackendMode>("checking");
  const [livePosts, setLivePosts] = useState<LibraryPost[]>([]);
  const user = DEMO_USERS[userIdx];

  useEffect(() => {
    let alive = true;
    const check = () => checkBackend().then((ok) => alive && setBackend(ok ? "live" : "offline"));
    check();
    const t = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, [p]);

  const refreshLibrary = useCallback(() => {
    if (backend === "live") libraryApi.list().then(setLivePosts).catch(() => undefined);
  }, [backend]);
  useEffect(refreshLibrary, [refreshLibrary]);

  const engineState: EngineState = useMemo(
    () => ({ learned: p.learned, supersededAtRuntime: p.supersededAtRuntime, resolved: p.resolved }),
    [p.learned, p.supersededAtRuntime, p.resolved],
  );

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3800);
  }, []);

  const setUserIdx = (i: number) => {
    setUserIdxRaw(i);
    setView(VIEWS_BY_ROLE[DEMO_USERS[i].role][0]);
  };

  const ask = (text: string) => {
    const { personaId, role } = user;
    const qId = crypto.randomUUID();
    const msgs: ChatMessage[] = [
      { id: crypto.randomUUID(), from: "user", text },
      { id: qId, from: "q", text: "", pending: true },
    ];
    setP((s) => ({ ...s, chats: { ...s.chats, [personaId]: [...(s.chats[personaId] ?? []), ...msgs] } }));

    const finish = (answer: Answer, source: "live" | "demo") =>
      setP((s) => {
        let openQuestions = s.openQuestions;
        if (answer.kind === "gap" && answer.askPerson && !s.openQuestions.some((q) => !q.resolved && ((answer.gapId && q.gapId === answer.gapId) || q.text === text))) {
          openQuestions = [{ id: crypto.randomUUID(), text, askedBy: personaId, askedAt: TODAY, routedTo: answer.askPerson.id, gapId: answer.gapId }, ...s.openQuestions];
        }
        const chat = (s.chats[personaId] ?? []).map((m) => (m.id === qId ? { id: qId, from: "q" as const, text: answer.text, answer, source } : m));
        return { ...s, openQuestions, chats: { ...s.chats, [personaId]: chat } };
      });

    if (backend !== "live") {
      setTimeout(() => finish(engineAsk(text, role, personaId, engineState), "demo"), 450);
      return;
    }
    askBackend(text, role, personaId, engineState)
      .then((a) => finish(a, "live"))
      .catch(() => {
        setBackend("offline");
        finish(engineAsk(text, role, personaId, engineState), "demo");
      });
  };

  const learn = (i: LearnInput): Fact => {
    const clean = redactedString(i.text);
    const fact: Fact = {
      id: `L${Date.now().toString(36)}`,
      category: i.category ?? guessCategory(clean),
      topic: i.topic ?? clean.split(/[.:–]/)[0].slice(0, 60),
      de: clean,
      en: "",
      owner: i.owner,
      department: i.via === "library" ? "ALL" : personaById(i.owner)?.department ?? "ALL",
      access: "internal",
      valid_from: TODAY,
      status: "current",
      question_ids: i.gapId ? [i.gapId] : [],
      sources_planned: [i.via === "interview" ? "interview" : "doc"],
      learned: { label: i.label, at: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), via: i.via },
    };
    if (backend === "live" && i.sync) {
      const question = p.openQuestions.find((q) => i.gapId && q.gapId === i.gapId && !q.resolved)?.text;
      learnBackend({ text: clean, user_id: i.owner, label: i.label, via: i.via, topic: i.topic, category: fact.category, question }).catch(() => undefined);
    }
    setP((s) => ({
      ...s,
      learned: [...s.learned, fact],
      openQuestions: s.openQuestions.map((q) => (i.gapId && q.gapId === i.gapId ? { ...q, resolved: true } : q)),
    }));
    return fact;
  };

  const resolveOpenQuestion = (id: string) =>
    setP((s) => ({ ...s, openQuestions: s.openQuestions.map((q) => (q.id === id ? { ...q, resolved: true } : q)) }));

  const addPost = async (text: string, category: string, file?: File) => {
    const me = personaById(user.personaId)!;
    if (backend === "live") {
      if (file) await libraryApi.upload(me.id, file, category);
      if (text.trim()) await libraryApi.add(me.id, text.trim(), category);
      refreshLibrary();
      return;
    }
    const body = [text.trim(), file ? `Anhang: ${file.name}` : ""].filter(Boolean).join("\n");
    const post: LibraryPost = {
      id: crypto.randomUUID(),
      factId: `LB${Date.now().toString(36)}`,
      user_id: me.id,
      author: me.name,
      category,
      created: new Date().toISOString().slice(0, 19),
      text: redactedString(body),
    };
    setP((s) => ({ ...s, posts: [post, ...s.posts], learned: [...s.learned, libraryFact(post)] }));
  };

  const resolvePost = async (id: string) => {
    if (backend === "live") {
      await libraryApi.resolve(id);
      refreshLibrary();
      return;
    }
    setP((s) => {
      const post = s.posts.find((x) => x.id === id);
      return {
        ...s,
        posts: s.posts.map((x) => (x.id === id ? { ...x, resolved: true } : x)),
        supersededAtRuntime: post?.factId ? [...s.supersededAtRuntime, post.factId] : s.supersededAtRuntime,
      };
    });
  };

  const toggleCheck = (k: string) => setP((s) => ({ ...s, checks: { ...s.checks, [k]: !s.checks[k] } }));

  const reset = () => {
    setP(seed());
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(INTERVIEW_KEY)) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    if (backend === "live") resetBackend().then(refreshLibrary).catch(() => undefined);
    toast({ title: "Demo zurückgesetzt" });
  };

  const libraryPosts = backend === "live" ? livePosts : p.posts;

  return (
    <Ctx.Provider
      value={{ ...p, userIdx, user, view, draft, toasts, engineState, backend, libraryPosts, setUserIdx, setView, setDraft, ask, learn, resolveOpenQuestion, addPost, resolvePost, refreshLibrary, toggleCheck, toast, reset }}
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
