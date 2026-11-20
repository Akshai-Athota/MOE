import { motion } from "framer-motion";
import { AlertOctagon, CalendarHeart, CheckCircle2, Clock, Flame, HelpCircle, Mic, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CitationChip } from "../components/Sources";
import { Avatar, Badge, Button, Card, Drawer, ProgressRing, SectionTitle, Stat, cx } from "../components/ui";
import { CATEGORIES, DATA, TODAY, daysUntil, fmtDate, personaById } from "../lib/data";
import { allFacts, citationFor } from "../lib/engine";
import { useStore } from "../lib/store";
import type { Fact, Question } from "../lib/types";

type Status = "covered" | "learned" | "risk" | "gap";
const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
  covered: { label: "Abgesichert", cls: "bg-brand-500 text-white", dot: "bg-brand-500" },
  learned: { label: "Heute gelernt", cls: "bg-mint-500 text-white", dot: "bg-mint-500" },
  risk: { label: "Hängt an Ruheständler:innen", cls: "bg-coral-500 text-white", dot: "bg-coral-500" },
  gap: { label: "Lücke", cls: "bg-white text-rose-500 ring-2 ring-inset ring-rose-100 border-dashed", dot: "bg-rose-100 ring-1 ring-rose-500" },
};

export default function CoverageView() {
  const { engineState, openQuestions, setView } = useStore();
  const [sel, setSel] = useState<{ q: Question; facts: Fact[]; status: Status }>();
  const facts = useMemo(() => allFacts(engineState).filter((f) => f.status !== "superseded" && f.valid_from <= TODAY), [engineState]);

  const statusOf = (qid: string): { status: Status; facts: Fact[] } => {
    const fs = facts.filter((f) => f.question_ids.includes(qid));
    if (!fs.length) return { status: "gap", facts: fs };
    if (fs.some((f) => f.learned)) return { status: "learned", facts: fs };
    const atRisk = fs.some(
      (f) => [f.owner, ...(f.also_known_by ?? [])].every((id) => personaById(id)?.status === "leaving") && !f.sources_planned.some((m) => m === "doc" || m === "intranet"),
    );
    return { status: atRisk ? "risk" : "covered", facts: fs };
  };

  const qs = DATA.questions.filter((q) => q.id.startsWith("Q") || q.category === "general");
  const rows = Object.keys(CATEGORIES)
    .filter((c) => c !== "public")
    .map((cat) => ({ cat, items: qs.filter((q) => q.category === cat).map((q) => ({ q, ...statusOf(q.id) })) }))
    .filter((r) => r.items.length);
  const all = rows.flatMap((r) => r.items);
  const count = (s: Status) => all.filter((x) => x.status === s).length;
  const coverage = (all.length - count("gap")) / all.length;

  const leavers = DATA.personas.filter((p) => p.status === "leaving");
  const risk = (id: string) => {
    const own = DATA.facts.filter((f) => f.owner === id || (f.also_known_by ?? []).includes(id));
    const only = own.filter((f) => [f.owner, ...(f.also_known_by ?? [])].every((x) => personaById(x)?.status === "leaving") && !f.sources_planned.some((m) => m === "doc" || m === "intranet"));
    const learned = engineState.learned.filter((f) => f.owner === id).length;
    return { own: own.length, only: only.length, learned };
  };
  const pending = openQuestions.filter((q) => !q.resolved);

  return (
    <div className="pb-10">
      <PageHeader eyebrow="Wissenslandkarte" title="Wo steckt unser Wissen – und wo fehlt es?" sub="Jedes Kästchen ist eine Onboarding-Frage aus dem Leitfaden „Das Gedächtnis der Verwaltung“. So sieht man auf einen Blick, welches Wissen mit dem Ruhestand verloren ginge." />
      <div className="space-y-6 px-5 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="flex items-center gap-4 p-5">
            <ProgressRing value={coverage} size={64} stroke={7} color="#573CFA" track="#EAE6FF">
              <span className="text-[14px] font-extrabold text-brand-600">{Math.round(coverage * 100)}%</span>
            </ProgressRing>
            <div>
              <div className="font-bold">Fragen beantwortbar</div>
              <div className="text-[13px] text-muted">
                {all.length - count("gap")} von {all.length}
              </div>
            </div>
          </Card>
          <Stat label="Fragen mit Wissen nur bei Ruheständler:innen" value={count("risk")} icon={<Flame size={20} />} tone="coral" />
          <Stat label="Wissenslücken" value={count("gap")} icon={<AlertOctagon size={20} />} tone="rose" />
          <Stat label="Offene Fragen im Team" value={pending.length} icon={<HelpCircle size={20} />} tone="amber" />
        </div>

        <Card className="p-6">
          <SectionTitle
            title="Abdeckung je Themenbereich"
            sub="Tippe auf ein Kästchen für Details"
            right={
              <div className="hidden flex-wrap gap-3 md:flex">
                {(Object.keys(STATUS) as Status[]).map((s) => (
                  <span key={s} className="flex items-center gap-1.5 text-[12px] text-muted">
                    <span className={cx("h-3 w-3 rounded-[5px]", STATUS[s].dot)} />
                    {STATUS[s].label}
                  </span>
                ))}
              </div>
            }
          />
          <div className="space-y-3">
            {rows.map((r, ri) => (
              <div key={r.cat} className="grid items-center gap-3 sm:grid-cols-[210px_1fr]">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORIES[r.cat].color }} />
                  {CATEGORIES[r.cat].de}
                  <span className="text-muted">· {r.items.filter((x) => x.status !== "gap").length}/{r.items.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.items.map((x, k) => (
                    <motion.button
                      key={x.q.id}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: ri * 0.04 + k * 0.015 }}
                      whileHover={{ y: -2 }}
                      onClick={() => setSel(x)}
                      title={x.q.de}
                      className={cx("grid h-10 w-12 place-items-center rounded-xl text-[11px] font-bold shadow-soft transition", STATUS[x.status].cls)}
                    >
                      {x.q.id}
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card className="p-6">
            <SectionTitle title="Wissensrisiko durch Ruhestand" sub="Wie viel Wissen ist schon gesichert?" />
            <div className="space-y-4">
              {leavers.map((p) => {
                const r = risk(p.id);
                const secured = Math.min(1, 1 - r.only / Math.max(1, r.own) + r.learned * 0.08);
                return (
                  <div key={p.id} className="rounded-3xl border border-line p-4">
                    <div className="flex items-center gap-3">
                      <Avatar p={p} size={46} />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{p.name}</div>
                        <div className="truncate text-[12px] text-muted">{p.role_de.split("(")[0]}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-extrabold text-coral-500">{daysUntil(p.leave_date!)}</div>
                        <div className="text-[11px] text-muted">Tage bis {fmtDate(p.leave_date)}</div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1.5 flex justify-between text-[12px]">
                        <span className="text-muted">
                          {r.only} Themen nur bei {p.name.split(" ")[0]} · {r.learned} heute gesichert
                        </span>
                        <b>{Math.round(secured * 100)}% gesichert</b>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-coral-50">
                        <motion.div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400" initial={{ width: 0 }} animate={{ width: `${secured * 100}%` }} transition={{ duration: 0.9 }} />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="soft" icon={<Mic size={14} />}>
                        Interview planen
                      </Button>
                      <Button size="sm" variant="outline" icon={<CalendarHeart size={14} />} onClick={() => setView("celebration")}>
                        Abschied mit Quiz planen
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle title="Offene Fragen aus dem Team" sub="Werden automatisch ins nächste Interview gelegt" />
            <div className="space-y-2">
              {openQuestions.map((q) => {
                const by = personaById(q.askedBy)!;
                const to = personaById(q.routedTo)!;
                return (
                  <div key={q.id} className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                    <Avatar p={by} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{q.text}</div>
                      <div className="text-[11px] text-muted">
                        {by.name.split(" ")[0]} → {to.name}
                      </div>
                    </div>
                    {q.resolved ? (
                      <Badge tone="mint" icon={<CheckCircle2 size={11} />}>Geklärt</Badge>
                    ) : (
                      <Badge tone="amber" icon={<Clock size={11} />}>Offen</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Drawer open={!!sel} onClose={() => setSel(undefined)} title={sel?.q.id ?? ""}>
        {sel && (
          <div className="space-y-4">
            <Badge tone={sel.status === "gap" ? "rose" : sel.status === "risk" ? "coral" : sel.status === "learned" ? "mint" : "brand"}>{STATUS[sel.status].label}</Badge>
            <h3 className="text-lg font-extrabold leading-snug">{sel.q.de}</h3>
            {sel.q.adaptation && <p className="text-[13px] text-muted">Für das Finanzamt angepasst: {sel.q.adaptation}</p>}
            {sel.facts.length === 0 ? (
              <div className="rounded-2xl bg-rose-50 p-4 text-[13px] text-rose-700">
                Keine Quelle vorhanden. {(() => {
                  const g = DATA.plants.planted_gaps.find((x) => x.id === sel.q.id);
                  return g ? `Am ehesten weiß es ${personaById(g.who_to_ask)?.name} – die Frage liegt im nächsten Interview.` : "";
                })()}
              </div>
            ) : (
              sel.facts.map((f) => (
                <div key={f.id} className="rounded-2xl border border-line p-3.5">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold">
                    {f.learned && <Sparkles size={13} className="text-mint-500" />}
                    {f.topic}
                  </div>
                  <p className="mt-1 text-[13px] text-ink/80">{f.de}</p>
                  <div className="mt-2">
                    <CitationChip c={citationFor(f)} onClick={() => {}} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
