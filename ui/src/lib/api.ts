/**
 * Connection to Finn's RAG backend (FastAPI, `hilde/api/main.py`).
 *
 * The dev server proxies /api -> http://localhost:8000 (vite.config.ts). Set VITE_API_BASE to point
 * elsewhere. If the backend is not reachable, the store falls back to the in-browser engine
 * (engine.ts), so the demo always works.
 */
import { DATA, TODAY, personaById } from "./data";
import { ask as engineAsk, type EngineState } from "./engine";
import type { Answer, Citation, Fact, LibraryPost, Modality, Role, Voucher } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
/** Local LLM on a laptop GPU: first answer can take a while (model load). */
const ASK_TIMEOUT_MS = 120_000;

export type BackendMode = "checking" | "live" | "offline";

/* ---------------- backend shapes (hilde/schemas.py) ---------------- */
interface BContact {
  id: string;
  name: string;
  role_de: string;
  room: string;
  phone_ext: string;
  email: string;
}
interface BCitation {
  n: number;
  source_id: string;
  source_type: string;
  citation: string;
  snippet: string;
  status: string;
  valid_from?: string | null;
  anchor: Record<string, string | number>;
  source_file?: string | null;
  owner?: string | null;
  modality?: string | null;
  title?: string | null;
  fact_ids: string[];
}
interface BChange {
  n: number;
  source_id: string;
  changed_on?: string | null;
  previous_source_id: string;
  previous_text: string;
}
interface BAnswer {
  question: string;
  answer: string;
  abstained: boolean;
  conflict: boolean;
  citations: BCitation[];
  changes: BChange[];
  who_to_ask?: BContact | null;
  open_question_id?: string | null;
  blocked: boolean;
  restricted_owner?: BContact | null;
  seconds: number;
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function checkBackend(): Promise<boolean> {
  try {
    const h = await request<{ ok: boolean }>("/health", undefined, 5000);
    return h.ok === true;
  } catch {
    return false;
  }
}

/* ---------------- mapping backend -> UI ---------------- */
function kindOf(c: BCitation): Modality {
  if (c.source_id.startsWith("intranet")) return "intranet";
  if (c.source_id.startsWith("minutes")) return "minutes";
  switch (c.modality) {
    case "audio":
    case "text":
    case "interview":
      return "interview";
    case "video":
      return "video";
    case "email":
      return "email";
    case "image":
      return "image";
    default:
      return "doc";
  }
}

function anchorOf(a: BCitation["anchor"]): string | undefined {
  if (a.t_start !== undefined) {
    const s = Math.floor(Number(a.t_start));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  if (a.paragraph !== undefined) return `Abs. ${a.paragraph}`;
  if (a.mail !== undefined) return `Mail ${a.mail}`;
  if (a.turn !== undefined) return `Frage ${a.turn}`;
  if (a.page !== undefined) return `S. ${a.page}`;
  if (a.section !== undefined) return String(a.section).slice(0, 28);
  return undefined;
}

/** The cited text as a Fact, so the source drawer can show it (owner, date, history). */
function toFact(c: BCitation): Fact {
  const known = c.fact_ids.length === 1 ? DATA.facts.find((f) => f.id === c.fact_ids[0]) : undefined;
  const learned = c.source_id.startsWith("learned-");
  return {
    id: `${c.source_id}#${c.n}`,
    category: known?.category ?? "general",
    topic: c.title ?? c.citation,
    de: c.snippet,
    en: "",
    owner: c.owner ?? known?.owner ?? "p01",
    department: known?.department ?? "ALL",
    access: known?.access ?? "internal",
    valid_from: c.valid_from ?? known?.valid_from ?? TODAY,
    status: c.status === "conflict" ? "conflict" : "current",
    rule: known?.rule ?? null,
    question_ids: known?.question_ids ?? [],
    sources_planned: [kindOf(c)],
    learned: learned ? { label: c.citation, at: "live", via: c.modality === "doc" ? "upload" : "interview" } : undefined,
  };
}

function toCitation(c: BCitation): Citation {
  return { factId: `${c.source_id}#${c.n}`, label: c.citation, kind: kindOf(c), anchor: anchorOf(c.anchor) };
}

export function mapAnswer(b: BAnswer, query: string, role: Role, personaId: string, state: EngineState): Answer {
  if (b.blocked) {
    return { kind: "blocked", text: b.answer, facts: [], citations: [], askPerson: personaById(b.restricted_owner?.id) };
  }
  if (b.abstained) {
    if (!b.who_to_ask) return { kind: "answer", text: b.answer, facts: [], citations: [] }; // small talk / off-topic
    // planted demo gaps route to their leaver and keep a gapId, so the interview loop can close them
    const local = engineAsk(query, role, personaId, state);
    const gap = local.kind === "gap" && local.gapId ? local : undefined;
    const who = gap?.askPerson ?? personaById(b.who_to_ask.id);
    const text = gap ? gap.text : b.answer;
    return { kind: "gap", text, facts: [], citations: [], askPerson: who, queued: true, gapId: gap?.gapId };
  }
  const facts = b.citations.map(toFact);
  const citations = b.citations.map(toCitation);
  const ch = b.changes[0];
  const changedFrom: Fact | undefined = ch
    ? { ...facts[0], id: ch.previous_source_id, de: ch.previous_text, valid_from: "", learned: undefined }
    : undefined;
  if (ch && facts[0] && ch.changed_on) facts[0] = { ...facts[0], valid_from: ch.changed_on };
  // a scheduled change (uploaded order, valid later) for one of the cited facts
  const cited = new Set(b.citations.flatMap((c) => c.fact_ids));
  const upcoming = state.learned.find((l) => l.supersedes && cited.has(l.supersedes) && l.valid_from > TODAY);
  return {
    kind: b.conflict ? "conflict" : "answer",
    text: b.answer,
    facts,
    citations,
    changedFrom,
    upcoming,
    conflictWith: b.conflict ? facts.slice(1) : undefined,
  };
}

export async function askBackend(query: string, role: Role, personaId: string, state: EngineState): Promise<Answer> {
  const b = await request<BAnswer>("/ask", { method: "POST", body: JSON.stringify({ question: query, user_id: personaId }) }, ASK_TIMEOUT_MS);
  return mapAnswer(b, query, role, personaId, state);
}

export interface LearnPayload {
  text: string;
  user_id: string;
  label: string;
  via: "interview" | "upload" | "library";
  topic?: string;
  category?: string;
  valid_from?: string;
  supersedes?: string;
  question?: string;
}

/** Index captured knowledge in the backend, so the next /ask can use it. */
export async function learnBackend(p: LearnPayload): Promise<void> {
  await request("/learn", { method: "POST", body: JSON.stringify(p) }, 60_000);
}

/** Demo reset: the backend forgets knowledge learned live in the app. */
export async function resetBackend(): Promise<void> {
  await request("/reset-learned", { method: "POST" }, 20_000);
}

/* ---------------- interviewer (backend: hilde/interview.py) ---------------- */
export interface IvQuestion {
  kind: "open_question" | "gap" | "catalogue" | "follow_up";
  original: string;
  text: string;
  ref?: string | null;
  asked_by?: string | null;
  gap_id?: string | null;
  demo_answer?: string | null;
  card?: number | null;
}
export interface IvClaim {
  id: string;
  section: string;
  text: string;
  state: "NEU" | "BESTÄTIGT" | "AKTUALISIERT" | "WIDERSPRUCH";
  matched_citation?: string | null;
  matched_text?: string | null;
  reason?: string | null;
  turn?: number;
  published?: boolean;
}
export interface IvTurn {
  n: number;
  question: IvQuestion;
  answer: string;
  redacted: string[];
  claims: IvClaim[];
  indexed_now: boolean;
}
export interface IvHandbook {
  name: string;
  title: string;
  sections: { name: string; claims: IvClaim[] }[];
  covered: number;
  total: number;
  turns: number;
  remaining: number;
  published_at?: string | null;
  conflicts: number;
}
export interface IvCard {
  card: number;
  kind: "open_question" | "gap" | "catalogue";
  label: string;
  original: string;
  asked_by?: string | null;
  ref?: string | null;
  gap_id?: string | null;
  demo_answer?: string | null;
  /** the question as Finn asks it */
  text?: string;
  done: boolean;
  /** answer accepted, still being transcribed / structured in the background */
  pending?: boolean;
  /** processing failed: the card can be answered again */
  failed?: boolean;
}
export interface IvReward {
  card: number;
  unlocked: boolean;
  remaining: number;
  voucher: Voucher | null;
}
export interface IvSession {
  id: string;
  persona: string;
  current: IvQuestion | null;
  turns: IvTurn[];
  handbook: IvHandbook;
  deck: IvCard[];
  reward: IvReward;
  pending?: number[];
}

const IV_TIMEOUT = 180_000; // extraction + comparison on a local LLM
const post = <T,>(path: string, body?: unknown, timeout = IV_TIMEOUT) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, timeout);

export const interviewApi = {
  get: (sid: string) => request<IvSession>(`/interview/${sid}`, undefined, 20_000),
  start: (userId: string, openQuestions: { id: string; text: string; asked_by?: string; gap_id?: string }[]) =>
    post<IvSession>("/interview/start", { user_id: userId, open_questions: openQuestions }, 60_000),
  answer: (sid: string, answer: string) => post<IvSession & { turn: IvTurn }>(`/interview/${sid}/answer`, { answer }),
  pick: (sid: string, card: number) => post<IvSession>(`/interview/${sid}/pick`, { card }, 60_000),
  /** typed answer: returns at once, processing runs in the background */
  submit: (sid: string, card: number, answer: string) => post<IvSession>(`/interview/${sid}/submit`, { card, answer }, 20_000),
  /** audio answer: returns at once, Whisper + processing run in the background */
  submitAudio: async (sid: string, card: number, audio: Blob, filename = "antwort.webm") => {
    const fd = new FormData();
    fd.append("card", String(card));
    fd.append("file", audio, filename);
    const r = await fetch(`${BASE}/interview/${sid}/submit-audio`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`submit-audio: HTTP ${r.status}`);
    return (await r.json()) as IvSession;
  },
  /** audio answer: transcribed by Whisper on the server, then redacted and structured */
  answerAudio: async (sid: string, audio: Blob, filename = "antwort.webm") => {
    const fd = new FormData();
    fd.append("file", audio, filename);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), IV_TIMEOUT);
    try {
      const r = await fetch(`${BASE}/interview/${sid}/answer-audio`, { method: "POST", body: fd, signal: ctrl.signal });
      if (!r.ok) throw new Error(`answer-audio: HTTP ${r.status}`);
      return (await r.json()) as IvSession & { turn: IvTurn };
    } finally {
      clearTimeout(t);
    }
  },
  focus: (sid: string, q: Partial<IvQuestion>) => post<IvSession>(`/interview/${sid}/focus`, { text: "", ...q }, 60_000),
  skip: (sid: string) => post<IvSession>(`/interview/${sid}/skip`, undefined, 60_000),
  publish: (sid: string) => post<IvSession & { result: { published: number; conflicts_flagged: number } }>(`/interview/${sid}/publish`),
};

/* ---------------- knowledge library (backend: hilde/library.py) ---------------- */
export const libraryApi = {
  list: () => request<LibraryPost[]>("/library", undefined, 10_000),
  add: (user_id: string, text: string, category: string) => post<LibraryPost>("/library", { user_id, text, category }, 60_000),
  resolve: (id: string) => post<LibraryPost>(`/library/${id}/resolve`, undefined, 20_000),
  /** attach a file (PDF, DOCX, image, audio): parsed, redacted and searchable */
  upload: async (user_id: string, file: File, category: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("user_id", user_id);
    fd.append("title", `Wissensbibliothek · ${file.name}`);
    fd.append("category", category);
    const r = await fetch(`${BASE}/ingest`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`ingest: HTTP ${r.status}`);
    return r.json();
  },
};
