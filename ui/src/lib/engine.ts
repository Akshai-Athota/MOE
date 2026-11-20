/**
 * Mock "brain" of Q, running fully in the browser on the synthetic dataset.
 * Person B's real pipeline (Qdrant + LLM) replaces this behind lib/api.ts with the same Answer shape.
 * Guardrails are applied BEFORE ranking: a role never gets content it may not see.
 */
import { DATA, TODAY, canSee, firstName, personaById, ruleById } from "./data";
import type { Answer, Citation, Fact, Gap, Role } from "./types";

const STOP = new Set(
  "der die das und oder ein eine einen einem einer ist sind wie was wer wo wann warum wieso welche welcher welches ich du er sie es wir ihr mich mir dich dir mein meine dein deine sein seine im in am an auf aus bei mit von vom zu zum zur fuer für über ueber unter nach vor bis gibt es hier dort man muss kann darf soll eigentlich denn noch auch nur schon mal bitte hallo hi q den dem des als wenn dass ob nicht kein keine so sich uns euch".split(" "),
);

const SYN: Record<string, string[]> = {
  park: ["parkplatz", "stellplatz", "parkausweis", "hof"],
  auto: ["parkplatz", "stellplatz", "ladesaeule"],
  essen: ["kantine"],
  mittag: ["kantine"],
  kantin: ["kantine"],
  urlaub: ["urlaub", "personalportal"],
  krank: ["krankheit", "arbeitsunfaehigkeit"],
  homeoffic: ["mobiles", "arbeiten"],
  homeoff: ["mobiles", "arbeiten"],
  remote: ["mobiles"],
  unterschr: ["zeichnen", "zeichnet", "zeichnungsrecht"],
  freigeb: ["zeichnet", "freigabe"],
  zeichn: ["zeichnet", "zeichnungsrecht"],
  vertret: ["vertretung", "vertreterin", "vertretungsplan"],
  vertrit: ["vertretung", "vertretungsplan"],
  passwor: ["passwoerter", "sicherheit"],
  computer: ["it-problemen", "lindner"],
  laptop: ["laptop", "it-problemen"],
  drucker: ["drucker"],
  presse: ["presseanfragen", "pressemitteilungen"],
  geld: ["budget", "sachmittelbudget"],
  budget: ["budget"],
  aufgetei: ["aufteilung"],
  aufteil: ["aufteilung"],
  haushalt: ["haushalt"],
  schlues: ["schluessel", "generalschluessel"],
  lade: ["ladesaeule"],
  fahrrad: ["fahrradraum"],
  rad: ["fahrradraum"],
  ticket: ["jobticket", "deutschlandticket"],
  geschenk: ["geschenke", "verabschiedung"],
  ruhestand: ["verabschiedung", "ruhestand"],
  oeffnungszeit: ["oeffnungszeiten"],
  geoeffnet: ["oeffnungszeiten", "geoeffnet"],
  mentor: ["mentor", "informell"],
  ungeschrieben: ["ungeschriebene", "regel"],
  regel: ["regel", "faustregel"],
  raum: ["besprechungsraeume", "raumkalender"],
  datenschutz: ["datenschutzkoordination"],
};

export function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9€\- ]/g, " ");
}

function stems(q: string): string[] {
  const out = new Set<string>();
  for (const t of norm(q).split(/\s+/)) {
    if (t.length < 3 || STOP.has(t)) continue;
    const s = t.length > 7 ? t.slice(0, 7) : t;
    out.add(s);
    for (const [k, extra] of Object.entries(SYN)) if (t.startsWith(k) || s.startsWith(k)) extra.forEach((e) => out.add(e.slice(0, 7)));
  }
  return [...out];
}

function scoreText(st: string[], text: string, weight = 1) {
  const t = norm(text);
  let s = 0;
  for (const x of st) if (x.length >= 3 && t.includes(x)) s += weight * (x.length >= 6 ? 1.2 : 1);
  return s;
}

export interface EngineState {
  learned: Fact[];
  supersededAtRuntime: string[];
  resolved: Record<string, string>; // conflict question -> truth fact id
}

export function allFacts(state: EngineState): Fact[] {
  return [...DATA.facts, ...state.learned].map((f) =>
    state.supersededAtRuntime.includes(f.id) ? { ...f, status: "superseded" as const } : f,
  );
}

function gapQuestions(): { id: string; text: string; gap: Gap }[] {
  return DATA.plants.planted_gaps.map((g) => ({
    id: g.id,
    gap: g,
    text: g.question_de ?? DATA.questions.find((q) => q.id === g.id)?.de ?? "",
  }));
}

function mmss(id: string) {
  const n = parseInt(id.replace(/\D/g, "") || "7", 10);
  const sec = (n * 37) % 640 + 25;
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function citationFor(f: Fact): Citation {
  const owner = personaById(f.owner);
  const short = owner ? `${owner.name.replace("Dr. ", "").split(" ")[0][0]}. ${owner.name.split(" ").slice(-1)[0]}` : "";
  if (f.learned) return { factId: f.id, label: f.learned.label, kind: f.learned.via === "upload" ? "doc" : "quiz", anchor: f.learned.at };
  const rule = ruleById(f.rule);
  const kind = (f.sources_planned[0] ?? "doc") as Citation["kind"];
  if (rule && (kind === "doc" || kind === "intranet")) return { factId: f.id, label: `${rule.id} · ${rule.title_de}`, kind: "doc", anchor: "§1" };
  switch (kind) {
    case "interview":
      return { factId: f.id, label: `Interview ${short}`, kind, anchor: mmss(f.id) };
    case "video":
      return { factId: f.id, label: `Bildschirmvideo ${short}`, kind, anchor: mmss(f.id) };
    case "email":
      return { factId: f.id, label: `E-Mail von ${short}`, kind };
    case "minutes":
      return { factId: f.id, label: "Protokoll Amtsleiterbesprechung", kind };
    case "intranet":
      return { factId: f.id, label: "Intranet FA-Info", kind };
    case "image":
      return { factId: f.id, label: `Whiteboard-Foto ${short}`, kind };
    default:
      return { factId: f.id, label: `Dokument: ${f.topic}`, kind: "doc" };
  }
}

const OPENERS: Record<Role, string[]> = {
  new_hire: ["Gute Frage – die stellen fast alle in den ersten Wochen.", "Klar, das erkläre ich dir gern.", "Kein Problem, hier die kurze Antwort:"],
  employee: ["Kurz und knapp:", "Hier die Antwort:", "Gern:"],
  leaver: ["Klar, Wolfgang:", "Kurz zusammengefasst:", "Gern:"],
  manager: ["Hier der aktuelle Stand:", "Kurz zusammengefasst:", "Aktueller Stand:"],
};

export function ask(query: string, role: Role, personaId: string, state: EngineState): Answer {
  const me = personaById(personaId)!;
  const st = stems(query);
  // scheduled changes (valid_from in the future) are not answers yet; they show up as "upcoming"
  const facts = allFacts(state).filter((f) => f.status !== "superseded" && f.valid_from <= TODAY);

  // 1) which catalogue / gap question is this most like?
  const catalogue = [...DATA.questions.map((q) => ({ id: q.id, text: q.de })), ...gapQuestions().map((g) => ({ id: g.id, text: g.text }))];
  let bestQ = { id: "", score: 0 };
  for (const q of catalogue) {
    const s = scoreText(st, q.text);
    if (s > bestQ.score) bestQ = { id: q.id, score: s };
  }

  // 2) rank facts (all, to detect restricted hits) - visible ones separately
  const ranked = facts
    .map((f) => {
      let s = scoreText(st, f.topic, 2) + scoreText(st, f.de, 1);
      if (bestQ.score >= 1.5 && f.question_ids.includes(bestQ.id)) s += 2.5;
      if (f.learned) s += 0.5;
      return { f, s };
    })
    .sort((a, b) => b.s - a.s);
  const visible = ranked.filter((r) => canSee(role, me.department, r.f));
  const topAll = ranked[0];
  const top = visible[0];

  // 3) planted gap still open?
  const gap = gapQuestions().find((g) => g.id === bestQ.id);
  const gapAnswered = gap && facts.some((f) => f.question_ids.includes(gap.id));
  if (gap && !gapAnswered && bestQ.score >= 1.5 && (!top || top.s < bestQ.score + 3)) {
    const who = personaById(gap.gap.who_to_ask);
    return {
      kind: "gap",
      text: `Das weiß ich noch nicht – dazu gibt es bisher keine Quelle. Am ehesten weiß es ${who?.name} (${who?.role_de}, Raum ${who?.room}, Durchwahl ${who?.phone_ext}). Ich habe deine Frage auf die Interviewliste von ${firstName(who)} gesetzt.`,
      facts: [],
      citations: [],
      askPerson: who,
      queued: true,
      gapId: gap.id,
    };
  }

  // 4) restricted hit the user may not see
  if (topAll && topAll.s >= 3 && !canSee(role, me.department, topAll.f) && (!top || topAll.s > top.s + 0.5)) {
    const owner = personaById(topAll.f.owner);
    return {
      kind: "blocked",
      text: `Dazu gibt es Informationen, die für deine Rolle nicht freigegeben sind. Wende dich bitte direkt an ${owner?.name} (Raum ${owner?.room}).`,
      facts: [],
      citations: [],
      askPerson: owner,
    };
  }

  // 5) nothing good enough -> honest "I don't know"
  if (!top || top.s < 2.2) {
    const cat = DATA.questions.find((q) => q.id === bestQ.id)?.category;
    const owners = DATA.facts.filter((f) => f.category === cat).map((f) => f.owner);
    const whoId = owners.sort((a, b) => owners.filter((x) => x === b).length - owners.filter((x) => x === a).length)[0] ?? "p09";
    const who = personaById(whoId);
    return {
      kind: "gap",
      text: `Dazu habe ich leider keine verlässliche Quelle. Frag am besten ${who?.name} (${who?.role_de}, Durchwahl ${who?.phone_ext}). Ich merke mir die Frage, damit sie beim nächsten Interview geklärt wird.`,
      facts: [],
      citations: [],
      askPerson: who,
      queued: true,
    };
  }

  let main = top.f;
  // 6) conflicts
  const conflict = DATA.plants.conflicts.find((c) => c.facts.includes(main.id));
  if (conflict) {
    const resolvedTruth = state.resolved[conflict.question];
    if (resolvedTruth) {
      main = facts.find((f) => f.id === resolvedTruth) ?? main;
    } else {
      const others = conflict.facts.filter((id) => id !== main.id).map((id) => facts.find((f) => f.id === id)!).filter(Boolean);
      const all = [main, ...others];
      const people = [...new Set(all.map((f) => personaById(f.owner)?.name))].join(" und ");
      return {
        kind: "conflict",
        text: `Achtung, hier widersprechen sich meine Quellen. Ich zeige dir beide – die Klärung habe ich bei ${people} angefragt.`,
        facts: all,
        citations: all.map(citationFor),
        conflictWith: others,
      };
    }
  }

  // 7) assemble: main + 1 supporting fact on the same question
  const support = visible
    .slice(1, 4)
    .filter((r) => r.s >= top.s * 0.8 && r.f.question_ids.some((q) => main.question_ids.includes(q)) && !DATA.plants.conflicts.some((c) => c.facts.includes(r.f.id)))
    .slice(0, 1)
    .map((r) => r.f);
  const used = [main, ...support];
  const changedFrom = main.supersedes ? allFacts(state).find((f) => f.id === main.supersedes) : undefined;
  const upcoming = state.learned.find((f) => f.supersedes === main.id && f.valid_from > TODAY);
  const opener = OPENERS[role][query.length % 3];

  return {
    kind: "answer",
    text: `${opener} ${used
      .map((f) => (f.learned && f.learned.via !== "upload" ? `${personaById(f.owner)?.name} hat dazu erklärt: „${f.de}“` : f.de))
      .join(" ")}`,
    facts: used,
    citations: used.map(citationFor),
    changedFrom,
    upcoming,
  };
}

/* ---------------- Redaction (Steuergeheimnis, § 30 AO) ---------------- */
export interface RedactPart {
  text: string;
  redacted?: string;
}
export function redact(text: string): RedactPart[] {
  const patterns: { re: RegExp; label: string }[] = [
    ...DATA.plants.redaction_targets.map((t) => ({
      re: new RegExp(t.value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"),
      label: t.type === "iban" ? "IBAN" : t.type === "tax_number" ? "Steuernummer" : t.type === "company" ? "Unternehmen" : "Steuerpflichtige Person",
    })),
    { re: /\b\d{2}\/\d{3}\/\d{5}\b/g, label: "Steuernummer" },
    { re: /\bDE\d{2}(?: ?\d{4}){4} ?\d{2}\b/g, label: "IBAN" },
  ];
  let parts: RedactPart[] = [{ text }];
  for (const { re, label } of patterns) {
    parts = parts.flatMap((p) => {
      if (p.redacted) return [p];
      const out: RedactPart[] = [];
      let last = 0;
      for (const m of p.text.matchAll(re)) {
        if (m.index! > last) out.push({ text: p.text.slice(last, m.index) });
        out.push({ text: m[0], redacted: label });
        last = m.index! + m[0].length;
      }
      if (last < p.text.length) out.push({ text: p.text.slice(last) });
      return out.length ? out : [p];
    });
  }
  return parts;
}
export const redactedString = (t: string) => redact(t).map((p) => (p.redacted ? `[${p.redacted}]` : p.text)).join("");

/* ---------------- Claim classification for new knowledge ---------------- */
const CAT_HINTS: [string, string[]][] = [
  ["finance", ["haushalt", "budget", "rechnung", "beschaff", "bestell", "euro", "€"]],
  ["it", ["laufwerk", "passwort", "laptop", "konsens", "e-akte", "software", "drucker"]],
  ["process", ["frist", "zeichn", "mitzeich", "bericht", "ablauf", "prozess"]],
  ["communication", ["presse", "mail", "teams", "newsletter"]],
  ["org", ["vertret", "zustaendig", "leitung", "entscheid"]],
  ["general", ["park", "kantine", "urlaub", "schluessel", "ladesaeule"]],
];
export function guessCategory(text: string) {
  const t = norm(text);
  for (const [cat, hints] of CAT_HINTS) if (hints.some((h) => t.includes(h))) return cat;
  return "practical";
}

/** Compare a new claim against existing knowledge: NEW / SAME / UPDATE. */
export function classifyClaim(text: string, state: EngineState): { kind: "NEW" | "SAME" | "UPDATE"; match?: Fact } {
  const st = stems(text);
  const best = allFacts(state)
    .filter((f) => f.status !== "superseded")
    .map((f) => ({ f, s: scoreText(st, f.de) / Math.max(4, st.length) }))
    .sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < 0.45) return { kind: "NEW" };
  return { kind: best.s > 0.8 ? "SAME" : "UPDATE", match: best.f };
}
