export type Access = "public" | "internal" | "restricted";
export type Role = "employee" | "new_hire" | "leaver" | "manager";
export type FactStatus = "current" | "superseded" | "conflict";
export type Modality = "interview" | "doc" | "email" | "minutes" | "image" | "video" | "intranet" | "quiz";

export interface Persona {
  id: string;
  name: string;
  department: "AL" | "RB" | "GS" | "VA";
  role_de: string;
  role_en: string;
  grade: string;
  status: "active" | "leaving" | "new";
  tenure_years: number;
  start_date: string;
  leave_date: string | null;
  reports_to: string;
  deputy: string | null;
  room: string;
  phone_ext: string;
  email: string;
  access_role: Role;
  speaking_style: string;
  voice: string;
  blind_spots: string[];
  mentor?: string;
  mentor_of?: string;
  motivation?: string[];
  interview_strategy?: string;
  interests?: string[];
  retirement_plans?: string;
  celebration_preference?: "party" | "solo";
}

export interface Fact {
  id: string;
  category: string;
  topic: string;
  de: string;
  en: string;
  owner: string;
  also_known_by?: string[];
  department: string;
  access: Access;
  valid_from: string;
  valid_to?: string | null;
  status?: FactStatus;
  supersedes?: string | null;
  rule?: string | null;
  question_ids: string[];
  sources_planned: Modality[];
  plant?: string | null;
  /** runtime-only: where a learned claim came from */
  learned?: { label: string; at: string; via: "interview" | "quiz" | "upload" };
}

export interface Rule {
  id: string;
  title_de: string;
  title_en: string;
  issued_by: string;
  valid_from: string;
  valid_to: string | null;
  supersedes: string | null;
  status: string;
  access: Access;
  summary_de: string;
  clauses: string[];
}

export interface Question {
  id: string;
  category: string;
  answer_type: string;
  de: string;
  adaptation?: string;
}

export interface Gap {
  id: string;
  who_to_ask: string;
  note: string;
  question_de?: string;
  live_demo_answer_de?: string;
}

export interface QuizQuestion {
  id: string;
  leaver: string;
  type: "funny" | "gap";
  question_de: string;
  options?: string[];
  answer?: number;
  answer_fact?: string;
  reveal_prompt_de?: string;
  gap_id?: string;
  host_line_de?: string;
}

export interface Dataset {
  company: any;
  personas: Persona[];
  rules: Rule[];
  facts: Fact[];
  plants: {
    superseded: { old: string; new: string; demo: string }[];
    conflicts: { facts: string[]; question: string; truth: string; resolution: string }[];
    restricted: string[];
    planted_gaps: Gap[];
    redaction_targets: { type: string; value: string; inject_into: string; context: string }[];
    live_update: { id: string; title_de: string; valid_from: string; changes: string; new_de: string }[];
  };
  questions: Question[];
  quiz: {
    settings: any;
    rewards: {
      principle: string;
      tax_fact: string;
      max_gift_eur: number;
      suggestions: Record<string, { de: string; est_eur: number; based_on: string }[]>;
    };
    leavers: Record<string, { name: string; last_day: string; mode: "party" | "solo" }>;
    questions: QuizQuestion[];
  };
}

export interface Citation {
  factId: string;
  label: string;
  kind: Modality;
  anchor?: string;
}

export interface Answer {
  kind: "answer" | "gap" | "blocked" | "conflict";
  text: string;
  facts: Fact[];
  citations: Citation[];
  changedFrom?: Fact;
  upcoming?: Fact;
  conflictWith?: Fact[];
  askPerson?: Persona;
  queued?: boolean;
  gapId?: string;
}

export interface ChatMessage {
  id: string;
  from: "user" | "q";
  text: string;
  answer?: Answer;
}

export interface OpenQuestion {
  id: string;
  text: string;
  askedBy: string;
  askedAt: string;
  routedTo: string;
  gapId?: string;
  resolved?: boolean;
}

export interface KnowledgeEvent {
  id: string;
  at: string;
  kind: "NEW" | "UPDATE" | "CONFLICT" | "SAME" | "RESOLVED";
  title: string;
  detail: string;
  source: string;
}
