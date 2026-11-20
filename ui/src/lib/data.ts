import raw from "../data/dataset.json";
import type { Dataset, Fact, Persona, Role } from "./types";

export const DATA = raw as unknown as Dataset;
export const TODAY = "2026-11-20";

export const personaById = (id?: string | null): Persona | undefined =>
  DATA.personas.find((p) => p.id === id);

export const ruleById = (id?: string | null) => DATA.rules.find((r) => r.id === id);

export const DEPARTMENTS: Record<string, string> = {
  AL: "Amtsleitung",
  RB: "Rechtsbehelfsstelle",
  GS: "Geschäftsstelle & Servicestelle",
  VA: "Arbeitnehmerbereich",
  ALL: "Ganzes Amt",
};

export const CATEGORIES: Record<string, { de: string; color: string }> = {
  org: { de: "Organisation", color: "#573CFA" },
  process: { de: "Prozesse", color: "#2FA8F5" },
  project: { de: "Projekte", color: "#8F78FC" },
  program: { de: "Geförderte Projekte", color: "#C04DE0" },
  finance: { de: "Finanzen & Beschaffung", color: "#12B886" },
  it: { de: "IT & Fachverfahren", color: "#0EA5A4" },
  oversight: { de: "Aufsicht & Gremien", color: "#F5A524" },
  communication: { de: "Kommunikation", color: "#FF7A59" },
  practical: { de: "Erste Wochen & Ungeschriebenes", color: "#E5486F" },
  general: { de: "Alltag im Amt", color: "#6E6A85" },
  public: { de: "Öffentlich", color: "#17132B" },
};

/** Demo users, one per role. */
export const DEMO_USERS: { personaId: string; role: Role; label: string }[] = [
  { personaId: "p13", role: "new_hire", label: "Neu im Amt" },
  { personaId: "p05", role: "leaver", label: "Geht in Ruhestand" },
  { personaId: "p03", role: "employee", label: "Mitarbeitende" },
  { personaId: "p10", role: "manager", label: "Führungskraft" },
];

export const ROLE_LABEL: Record<Role, string> = {
  new_hire: "Neu im Amt",
  leaver: "Ruhestand",
  employee: "Mitarbeitende",
  manager: "Führungskraft",
};

/** Retrieval guardrail: what a role may see. Enforced BEFORE ranking. */
export function canSee(role: Role, dept: string, f: Fact): boolean {
  if (f.access === "public") return true;
  if (f.access === "restricted") return role === "manager";
  if (role === "employee") {
    return f.category === "general" || f.department === "ALL" || f.department === dept;
  }
  return true;
}

export function firstName(p?: Persona) {
  if (!p) return "";
  const parts = p.name.replace("Dr. ", "").split(" ");
  return parts[0];
}

export function initials(name: string) {
  return name
    .replace("Dr. ", "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function daysUntil(iso: string) {
  return Math.round((Date.parse(iso) - Date.parse(TODAY)) / 86400000);
}

const AVATAR_COLORS = ["#573CFA", "#FF7A59", "#12B886", "#2FA8F5", "#C04DE0", "#F5A524", "#E5486F", "#0EA5A4"];
export function avatarColor(id: string) {
  const n = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}
