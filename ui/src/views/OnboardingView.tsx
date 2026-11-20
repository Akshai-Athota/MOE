import { motion } from "framer-motion";
import { ArrowRight, BookOpen, CalendarDays, Check, Clock, FileText, Hourglass, MessageCircle, Quote, Sparkles } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Avatar, Badge, Button, Card, Drawer, ProgressRing, SectionTitle, cx } from "../components/ui";
import { DATA, daysUntil, fmtDate, personaById, ruleById } from "../lib/data";
import { useStore } from "../lib/store";
import type { Rule } from "../lib/types";

const STEPS = [
  {
    when: "Tag 1",
    title: "Ankommen & Zugänge",
    items: [
      { k: "d1-ds", t: "Datenschutzbelehrung & Verpflichtung auf das Steuergeheimnis" },
      { k: "d1-it", t: "Laptop und Token bei Marco Lindner abholen (Raum 0.08)" },
      { k: "d1-park", t: "Gastparkausweis an der Servicestelle holen (Raum 0.02)" },
    ],
    ask: "Was muss ich am ersten Tag erledigen?",
  },
  { when: "Woche 1–2", title: "KONSENS-Schulung", items: [{ k: "w1-konsens", t: "Schulung zu den Veranlagungsverfahren abschließen" }], ask: "Welche Software nutze ich täglich?" },
  {
    when: "ab Woche 2",
    title: "Erste eigene Fälle",
    items: [{ k: "w2-cases", t: "Erste Fälle bearbeiten – alle Bescheide zeichnet dein Mentor mit (6 Monate)" }],
    ask: "Wer zeichnet meine Bescheide in den ersten Monaten?",
  },
  { when: "Woche 3", title: "E-Akte kennenlernen", items: [{ k: "w3-eakte", t: "Einführung in die E-Akte bei Julia Nowak" }], ask: "Wie läuft das Projekt E-Akte?" },
  {
    when: "bis Tag 30",
    title: "Den Überblick haben",
    items: [
      { k: "d30-back", t: "Rückstandsliste des Sachgebiets kennen" },
      { k: "d30-read", t: "Pflichtlektüre gelesen" },
    ],
    ask: "Was sollte ich in den ersten 30 Tagen verstehen?",
  },
];

const MUST_READ = ["HV-2026-07", "DV-2024-01", "HV-2025-04", "HV-2023-05"];
const RULE_FACTS = ["F072", "F073", "F102", "F075", "F051", "F076", "F069"];
const MEETINGS = [
  { day: "Mo", time: "9:00", t: "Amtsleiterbesprechung", note: "nur Leitungen", muted: true },
  { day: "Di", time: "10:00", t: "Sachgebietsrunde Arbeitnehmerbereich", note: "Raum 2.20 „Galgenberg“" },
  { day: "Mi", time: "14:00", t: "E-Akte Stand-up (15 Min.)", note: "Planner-Board „E-Akte VA“" },
  { day: "Fr", time: "9:30", t: "Kaffeerunde", note: "Teeküche 2. OG · informell" },
];

export default function OnboardingView() {
  const { user, checks, toggleCheck, setDraft, setView, openQuestions } = useStore();
  const me = personaById(user.personaId)!;
  const mentor = personaById(me.mentor)!;
  const team = DATA.personas.filter((p) => p.department === me.department && p.id !== me.id);
  const allItems = STEPS.flatMap((s) => s.items);
  const done = allItems.filter((i) => checks[i.k]).length;
  const [rule, setRule] = useState<Rule>();
  const startIn = daysUntil(me.start_date);
  const mentorLeft = daysUntil(mentor.leave_date!);
  const myOpen = openQuestions.filter((q) => q.askedBy === me.id);

  const askQ = (q: string) => {
    setDraft(q);
    setView("ask");
  };

  return (
    <div className="pb-10">
      <PageHeader eyebrow="Mein Start" title="Dein Onboarding" sub="Alles, was du in den ersten 30 Tagen brauchst – zusammengestellt aus dem Wissen deiner Kolleg:innen." />

      <div className="space-y-6 px-5 lg:px-8">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-hero relative overflow-hidden rounded-[32px] p-6 text-white lg:p-8">
          <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto_minmax(280px,340px)] lg:items-center">
            <div>
              <Badge tone="dark" className="!bg-white/15 !text-white !ring-white/20">
                <Sparkles size={11} /> Erster Arbeitstag {fmtDate(me.start_date)}
              </Badge>
              <h2 className="mt-3 text-[28px] font-extrabold leading-tight lg:text-[34px]">Willkommen im Team, {me.name.split(" ")[0]}! 👋</h2>
              <p className="mt-2 max-w-lg text-[15px] text-white/80">
                {startIn > 0 ? `Noch ${startIn} Tage bis zu deinem Start im ${me.role_de.split(",")[1]?.trim() ?? "Arbeitnehmerbereich"}.` : "Schön, dass du da bist!"} Ich begleite dich – frag mich alles, auch die „dummen“ Fragen.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="white" onClick={() => askQ("Was sollte ich in den ersten 30 Tagen verstehen?")} icon={<MessageCircle size={16} />}>
                  Frag Q
                </Button>
                <Button variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => document.getElementById("path")?.scrollIntoView({ behavior: "smooth" })}>
                  Zu deinem Fahrplan <ArrowRight size={16} />
                </Button>
              </div>
            </div>
            <ProgressRing value={done / allItems.length} size={128} stroke={11}>
              <div className="text-center">
                <div className="text-3xl font-extrabold">{Math.round((done / allItems.length) * 100)}%</div>
                <div className="text-[11px] text-white/75">erledigt</div>
              </div>
            </ProgressRing>
            <div className="rounded-3xl bg-white/12 p-4 ring-1 ring-white/20 backdrop-blur">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">Dein Mentor</div>
              <div className="mt-2.5 flex items-center gap-3">
                <Avatar p={mentor} size={48} ring />
                <div>
                  <div className="font-bold">{mentor.name}</div>
                  <div className="text-[12px] text-white/75">
                    Raum {mentor.room} · {mentor.phone_ext}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-coral-500/90 px-3 py-2 text-[12px] font-semibold">
                <Hourglass size={14} /> Geht in {mentorLeft} Tagen in Altersteilzeit – nutz die Zeit!
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          {/* Path */}
          <Card id="path" className="p-6">
            <SectionTitle title="Dein Fahrplan für die ersten 30 Tage" sub={`${done} von ${allItems.length} Schritten erledigt`} />
            <ol className="relative space-y-4 before:absolute before:left-[19px] before:top-3 before:h-[calc(100%-24px)] before:w-0.5 before:bg-brand-100">
              {STEPS.map((s, idx) => {
                const complete = s.items.every((i) => checks[i.k]);
                return (
                  <li key={s.when} className="relative flex gap-4">
                    <div className={cx("z-10 grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[13px] font-extrabold transition", complete ? "bg-mint-500 text-white" : "bg-brand-50 text-brand-600 ring-1 ring-brand-100")}>
                      {complete ? <Check size={18} /> : idx + 1}
                    </div>
                    <div className="flex-1 rounded-3xl border border-line p-4 transition hover:border-brand-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={complete ? "mint" : "brand"}>{s.when}</Badge>
                          <span className="font-bold">{s.title}</span>
                        </div>
                        <button onClick={() => askQ(s.ask)} className="flex items-center gap-1 text-[12px] font-semibold text-brand-600 hover:underline">
                          <MessageCircle size={13} /> Q fragen
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {s.items.map((i) => (
                          <label key={i.k} className="flex cursor-pointer items-start gap-3 rounded-2xl p-1.5 hover:bg-canvas">
                            <span
                              onClick={() => toggleCheck(i.k)}
                              className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-lg border-2 transition", checks[i.k] ? "border-mint-500 bg-mint-500 text-white" : "border-brand-200 bg-white")}
                            >
                              {checks[i.k] && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span onClick={() => toggleCheck(i.k)} className={cx("text-[14px]", checks[i.k] && "text-muted line-through")}>
                              {i.t}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <SectionTitle title="Dein Team" sub="Arbeitnehmerbereich · 2. OG" />
              <div className="space-y-2.5">
                {team.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar p={p} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {p.name}
                        {p.id === mentor.id && <Badge tone="brand">Mentor</Badge>}
                      </div>
                      <div className="truncate text-[12px] text-muted">{p.role_de.split(",")[0]}</div>
                    </div>
                    <span className="text-[12px] font-medium text-muted">{p.phone_ext}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-6">
              <SectionTitle title="Feste Termine" sub="Jede Woche" right={<CalendarDays size={18} className="text-brand-400" />} />
              <div className="space-y-2">
                {MEETINGS.map((m) => (
                  <div key={m.t} className={cx("flex items-center gap-3 rounded-2xl p-2.5", m.muted ? "opacity-50" : "bg-canvas")}>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-center shadow-soft">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-brand-500">{m.day}</div>
                        <div className="text-[11px] font-bold">{m.time}</div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">{m.t}</div>
                      <div className="truncate text-[11px] text-muted">{m.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Must read */}
        <div>
          <SectionTitle title="Pflichtlektüre" sub="Kurz erklärt – tippe für die Details" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {MUST_READ.map((id) => {
              const r = ruleById(id)!;
              const k = `read-${id}`;
              return (
                <Card key={id} className="group flex cursor-pointer flex-col p-5 transition hover:-translate-y-1 hover:shadow-lift" onClick={() => setRule(r)}>
                  <div className="flex items-start justify-between">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                      <FileText size={20} />
                    </div>
                    {checks[k] ? <Badge tone="mint" icon={<Check size={11} />}>Gelesen</Badge> : <Badge tone="gray">{id}</Badge>}
                  </div>
                  <div className="mt-4 font-bold leading-snug">{r.title_de}</div>
                  <p className="mt-1.5 line-clamp-3 text-[13px] text-muted">{r.summary_de}</p>
                  <div className="mt-auto flex items-center gap-1 pt-4 text-[12px] font-semibold text-brand-600">
                    <BookOpen size={13} /> {r.clauses.length} Regeln · lesen
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Unwritten rules */}
        <div>
          <SectionTitle title="Ungeschriebene Regeln" sub="Was nirgends steht – aber alle wissen. Aus Interviews mit erfahrenen Kolleg:innen." />
          <div className="scroll-thin -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3">
            {RULE_FACTS.map((id) => {
              const f = DATA.facts.find((x) => x.id === id)!;
              const p = personaById(f.owner)!;
              return (
                <Card key={id} className="w-[290px] shrink-0 snap-start p-5">
                  <Quote size={22} className="text-brand-200" />
                  <p className="mt-2 text-[14px] leading-relaxed">{f.de}</p>
                  <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3">
                    <Avatar p={p} size={30} />
                    <div className="min-w-0 text-[12px]">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="truncate text-muted">{p.status === "leaving" ? `geht ${fmtDate(p.leave_date)}` : p.role_de.split(",")[0]}</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {myOpen.length > 0 && (
          <Card className="p-6">
            <SectionTitle title="Deine offenen Fragen" sub="Q konnte sie noch nicht beantworten und hat sie an die richtige Person weitergegeben." />
            <div className="space-y-2">
              {myOpen.map((q) => {
                const to = personaById(q.routedTo)!;
                return (
                  <div key={q.id} className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                    <div className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", q.resolved ? "bg-mint-500 text-white" : "bg-white text-amber-500")}>
                      {q.resolved ? <Check size={16} /> : <Clock size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{q.text}</div>
                      <div className="text-[12px] text-muted">{q.resolved ? "Beantwortet – jetzt in Q verfügbar" : `Wartet auf ${to.name}`}</div>
                    </div>
                    {q.resolved && (
                      <Button size="sm" variant="soft" onClick={() => askQ(q.text)}>
                        Antwort ansehen
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <Drawer open={!!rule} onClose={() => setRule(undefined)} title={rule?.id ?? ""}>
        {rule && (
          <div className="space-y-5">
            <div>
              <Badge tone="brand">gültig seit {fmtDate(rule.valid_from)}</Badge>
              <h3 className="mt-2 text-xl font-extrabold">{rule.title_de}</h3>
              <p className="mt-2 text-[14px] text-muted">{rule.summary_de}</p>
            </div>
            <ol className="space-y-2.5">
              {rule.clauses.map((c, i) => (
                <li key={i} className="flex gap-3 rounded-2xl bg-canvas p-3.5 text-[14px]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-500 text-[11px] font-bold text-white">{i + 1}</span>
                  {c}
                </li>
              ))}
            </ol>
            <Button
              className="w-full"
              onClick={() => {
                if (!checks[`read-${rule.id}`]) toggleCheck(`read-${rule.id}`);
                setRule(undefined);
              }}
              icon={<Check size={16} />}
            >
              Als gelesen markieren
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
