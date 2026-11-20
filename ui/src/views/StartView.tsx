import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, PageHeader, SectionLabel, Sheet, cx } from "../components/ui";
import { daysUntil, fmtDate, personaById, ruleById } from "../lib/data";
import { useStore } from "../lib/store";
import type { Rule } from "../lib/types";

const STEPS: { when: string; items: { k: string; t: string }[] }[] = [
  {
    when: "Tag 1",
    items: [
      { k: "d1-ds", t: "Datenschutzbelehrung und Verpflichtung auf das Steuergeheimnis" },
      { k: "d1-it", t: "Laptop und Token bei Marco Lindner abholen, Raum 0.08" },
      { k: "d1-park", t: "Gastparkausweis an der Servicestelle holen, Raum 0.02" },
    ],
  },
  { when: "Woche 1–2", items: [{ k: "w1-konsens", t: "KONSENS-Schulung abschließen" }] },
  { when: "Ab Woche 2", items: [{ k: "w2-cases", t: "Erste eigene Fälle – dein Mentor zeichnet sechs Monate mit" }] },
  { when: "Woche 3", items: [{ k: "w3-eakte", t: "Einführung in die E-Akte bei Julia Nowak" }] },
  {
    when: "Bis Tag 30",
    items: [
      { k: "d30-back", t: "Rückstandsliste des Sachgebiets kennen" },
      { k: "d30-read", t: "Pflichtlektüre gelesen" },
    ],
  },
];
const READING = ["HV-2026-07", "DV-2024-01", "HV-2025-04", "HV-2023-05"];
const MEETINGS = [
  { day: "Di", time: "10:00", t: "Sachgebietsrunde", where: "Raum 2.20" },
  { day: "Mi", time: "14:00", t: "E-Akte Stand-up", where: "15 Minuten" },
  { day: "Fr", time: "9:30", t: "Kaffeerunde", where: "Teeküche 2. OG" },
];

export default function StartView() {
  const { user, checks, toggleCheck, setDraft, setView, openQuestions } = useStore();
  const me = personaById(user.personaId)!;
  const people = [
    { p: personaById(me.mentor), role: "Mentor" },
    { p: personaById(me.reports_to), role: "Sachgebietsleitung" },
    { p: personaById("p12"), role: "E-Akte & IT-Fragen" },
    { p: personaById("p07"), role: "IT-Koordination" },
  ];
  const all = STEPS.flatMap((s) => s.items);
  const done = all.filter((i) => checks[i.k]).length;
  const [rule, setRule] = useState<Rule>();
  const mine = openQuestions.filter((q) => q.askedBy === me.id);
  const askFinn = (q: string) => {
    setDraft(q);
    setView("ask");
  };
  const days = daysUntil(me.start_date);

  return (
    <div className="pb-16">
      <PageHeader
        title={`Willkommen, ${me.name.split(" ")[0]}`}
        sub={`${days > 0 ? `In ${days} Tagen geht es los` : "Schön, dass du da bist"} · ${fmtDate(me.start_date)} · Arbeitnehmerbereich, Raum ${me.room}`}
        right={<Button onClick={() => setView("ask")}>Frag Finn</Button>}
      />

      <div className="grid max-w-[1080px] gap-x-14 gap-y-12 px-6 pt-8 lg:grid-cols-[1fr_300px] lg:px-10">
        <section>
          <SectionLabel right={<span className="text-[12px] tabular-nums text-muted">{done} von {all.length}</span>}>Deine ersten 30 Tage</SectionLabel>
          <div className="divide-y divide-line border-y border-line">
            {STEPS.map((s) => (
              <div key={s.when} className="grid gap-2 py-3.5 sm:grid-cols-[110px_1fr]">
                <div className="pt-0.5 text-[13px] text-muted">{s.when}</div>
                <div className="space-y-2">
                  {s.items.map((i) => (
                    <button key={i.k} onClick={() => toggleCheck(i.k)} className="flex w-full items-start gap-3 text-left">
                      <span className={cx("mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors", checks[i.k] ? "border-accent bg-accent text-white" : "border-line-strong bg-surface")}>
                        {checks[i.k] && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className={cx("text-[14px] leading-snug", checks[i.k] ? "text-faint line-through" : "text-ink-2")}>{i.t}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12">
            <SectionLabel>Pflichtlektüre</SectionLabel>
            <div className="divide-y divide-line border-y border-line">
              {READING.map((id) => {
                const r = ruleById(id)!;
                return (
                  <button key={id} onClick={() => setRule(r)} className="flex w-full items-center gap-3 py-3 text-left hover:text-accent">
                    <span className="w-24 shrink-0 text-[12.5px] tabular-nums text-faint">{r.id}</span>
                    <span className="flex-1 text-[14px]">{r.title_de}</span>
                    {checks[`read-${id}`] && <Check size={14} className="text-accent" />}
                    <ChevronRight size={15} className="text-faint" />
                  </button>
                );
              })}
            </div>
          </div>

          {mine.length > 0 && (
            <div className="mt-12">
              <SectionLabel>Deine Fragen an Kolleg:innen</SectionLabel>
              <div className="divide-y divide-line border-y border-line">
                {mine.map((q) => (
                  <div key={q.id} className="flex items-center gap-3 py-3">
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", q.resolved ? "bg-accent" : "bg-gold")} />
                    <span className="flex-1 text-[14px]">{q.text}</span>
                    {q.resolved ? (
                      <button onClick={() => askFinn(q.text)} className="text-[12.5px] text-accent hover:underline">
                        Antwort ansehen
                      </button>
                    ) : (
                      <span className="text-[12.5px] text-muted">wartet auf {personaById(q.routedTo)?.name.split(" ")[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-12">
          <div>
            <SectionLabel>Ansprechpersonen</SectionLabel>
            <div className="space-y-3.5">
              {people.map(({ p, role }) =>
                p ? (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar p={p} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{p.name}</div>
                      <div className="truncate text-[12px] text-muted">
                        {role} · {p.phone_ext}
                      </div>
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </div>
          <div>
            <SectionLabel>Jede Woche</SectionLabel>
            <div className="space-y-3">
              {MEETINGS.map((m) => (
                <div key={m.t} className="flex items-baseline gap-3 text-[13.5px]">
                  <span className="w-[78px] shrink-0 whitespace-nowrap tabular-nums text-muted">
                    {m.day} {m.time}
                  </span>
                  <span className="flex-1">{m.t}</span>
                  <span className="text-[12px] text-faint">{m.where}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <Sheet open={!!rule} onClose={() => setRule(undefined)} title={rule?.id ?? ""}>
        {rule && (
          <div>
            <h3 className="text-[16px] font-semibold leading-snug">{rule.title_de}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{rule.summary_de}</p>
            <ol className="mt-6 space-y-3 border-t border-line pt-5">
              {rule.clauses.map((c, i) => (
                <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                  <span className="tabular-nums text-faint">{i + 1}.</span>
                  {c}
                </li>
              ))}
            </ol>
            <Button
              className="mt-8 w-full"
              variant={checks[`read-${rule.id}`] ? "secondary" : "primary"}
              onClick={() => {
                if (!checks[`read-${rule.id}`]) toggleCheck(`read-${rule.id}`);
                setRule(undefined);
              }}
            >
              {checks[`read-${rule.id}`] ? "Gelesen" : "Als gelesen markieren"}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
