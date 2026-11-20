import { AlertTriangle, ArrowRightLeft, BadgeCheck, CheckCheck, Clock3, FileUp, GitMerge, History, Plus, Scale, Sparkles } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Pipeline } from "../components/Pipeline";
import { CitationChip } from "../components/Sources";
import { Avatar, Badge, Button, Card, SectionTitle, Stat, cx } from "../components/ui";
import { DATA, fmtDate, personaById } from "../lib/data";
import { allFacts, citationFor } from "../lib/engine";
import { useStore } from "../lib/store";
import type { KnowledgeEvent } from "../lib/types";

const KIND: Record<KnowledgeEvent["kind"], { tone: "mint" | "brand" | "amber" | "sky" | "gray"; label: string; icon: typeof Plus }> = {
  NEW: { tone: "mint", label: "NEU", icon: Plus },
  UPDATE: { tone: "brand", label: "AKTUALISIERT", icon: ArrowRightLeft },
  CONFLICT: { tone: "amber", label: "WIDERSPRUCH", icon: AlertTriangle },
  SAME: { tone: "sky", label: "BESTÄTIGT", icon: BadgeCheck },
  RESOLVED: { tone: "mint", label: "GEKLÄRT", icon: CheckCheck },
};

export default function MemoryView() {
  const { events, resolved, resolveConflict, engineState, learn, toast } = useStore();
  const [pipe, setPipe] = useState(false);
  const facts = allFacts(engineState);
  const current = facts.filter((f) => f.status !== "superseded");
  const openConflicts = DATA.plants.conflicts.filter((c) => !resolved[c.question]);
  const upd = DATA.plants.live_update[0];
  const uploaded = engineState.learned.some((f) => f.supersedes === upd.changes);
  const stale = DATA.facts.filter((f) => f.valid_from < "2021-01-01" && f.status !== "superseded" && !(f.also_known_by ?? []).length).slice(0, 4);

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Wissen & Verlauf"
        title="Q lernt dazu – und vergisst nichts"
        sub="Neue Quellen werden mit dem vorhandenen Wissen abgeglichen: neu, bestätigt, aktualisiert oder widersprüchlich. Alte Stände bleiben als Verlauf erhalten."
        right={
          <Button onClick={() => setPipe(true)} disabled={uploaded} icon={<FileUp size={16} />}>
            {uploaded ? "HV-2026-12 verarbeitet" : "Neue Hausverfügung hochladen"}
          </Button>
        }
      />
      <div className="space-y-6 px-5 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Aktuelle Wissenseinträge" value={current.length} icon={<Sparkles size={20} />} />
          <Stat label="Aktualisiert, Verlauf erhalten" value={facts.filter((f) => f.status === "superseded").length + (uploaded ? 1 : 0)} icon={<History size={20} />} tone="sky" />
          <Stat label="Widersprüche offen" value={openConflicts.length} icon={<Scale size={20} />} tone="amber" />
          <Stat label="Heute neu gelernt" value={engineState.learned.length} icon={<GitMerge size={20} />} tone="mint" />
        </div>

        <Card className="p-6">
          <SectionTitle title="So hält Q das Wissen aktuell" sub="Jede neue Aussage wird mit vorhandenen verglichen – nichts wird gelöscht." />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { k: "NEW", d: "Noch nicht bekannt → neuer Eintrag mit Quelle." },
              { k: "SAME", d: "Schon bekannt → Quelle ergänzt, „zuletzt bestätigt“ aktualisiert." },
              { k: "UPDATE", d: "Neuer Stand → alter Eintrag wird Verlauf, Antworten zeigen „geändert am …“." },
              { k: "CONFLICT", d: "Widerspruch → beide Quellen sichtbar, Führungskraft entscheidet." },
            ].map((x) => {
              const m = KIND[x.k as KnowledgeEvent["kind"]];
              return (
                <div key={x.k} className="rounded-3xl bg-canvas p-4">
                  <Badge tone={m.tone} icon={<m.icon size={11} />}>
                    {m.label}
                  </Badge>
                  <p className="mt-2 text-[13px] text-ink/80">{x.d}</p>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
          <Card className="p-6">
            <SectionTitle title="Zeitleiste" sub="Was sich im Gedächtnis von Q verändert hat" />
            <div className="relative space-y-3 pl-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-line">
              {events.map((e) => {
                const m = KIND[e.kind];
                return (
                  <div key={e.id} className="relative">
                    <span className={cx("absolute -left-6 top-3 grid h-6 w-6 place-items-center rounded-full ring-4 ring-white", e.kind === "CONFLICT" ? "bg-amber-500" : e.kind === "UPDATE" ? "bg-brand-500" : e.kind === "SAME" ? "bg-sky-500" : "bg-mint-500")}>
                      <m.icon size={12} className="text-white" />
                    </span>
                    <div className="rounded-2xl border border-line p-3.5 transition hover:border-brand-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={m.tone}>{m.label}</Badge>
                        <span className="text-[14px] font-bold">{e.title}</span>
                        <span className="ml-auto text-[12px] text-muted">{fmtDate(e.at)}</span>
                      </div>
                      <p className="mt-1 text-[13px] text-muted">{e.detail}</p>
                      <div className="mt-1.5 text-[11px] font-semibold text-brand-600">{e.source}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <SectionTitle title="Zur Entscheidung" sub="Widersprüche, die eine Führungskraft klären sollte" right={<Badge tone="amber">{openConflicts.length} offen</Badge>} />
              <div className="space-y-4">
                {DATA.plants.conflicts.map((c) => {
                  const fs = c.facts.map((id) => DATA.facts.find((f) => f.id === id)!);
                  const q = DATA.questions.find((x) => x.id === c.question);
                  const done = resolved[c.question];
                  return (
                    <div key={c.question} className={cx("rounded-3xl border p-4", done ? "border-mint-100 bg-mint-50/40" : "border-amber-100 bg-amber-50/30")}>
                      <div className="mb-3 text-[13px] font-bold">{q?.de}</div>
                      <div className="space-y-2">
                        {fs.map((f) => {
                          const owner = personaById(f.owner)!;
                          const isTruth = c.truth === f.id;
                          const chosen = done === f.id;
                          return (
                            <div key={f.id} className={cx("rounded-2xl border bg-white p-3", chosen ? "border-mint-500 ring-2 ring-mint-100" : "border-line", done && !chosen && "opacity-50")}>
                              <div className="flex items-center gap-2">
                                <Avatar p={owner} size={24} />
                                <span className="text-[12px] font-semibold">{owner.name}</span>
                                <span className="ml-auto text-[11px] text-muted">seit {fmtDate(f.valid_from)}</span>
                              </div>
                              <p className="mt-1.5 text-[13px]">{f.de}</p>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <CitationChip c={citationFor(f)} onClick={() => {}} />
                                {!done && (
                                  <Button size="sm" variant={isTruth ? "primary" : "outline"} onClick={() => { resolveConflict(c.question, f.id); toast({ title: "Entschieden", body: "Q antwortet ab jetzt mit dieser Quelle.", tone: "mint" }); }}>
                                    {isTruth ? "Empfohlen · gilt" : "Diese gilt"}
                                  </Button>
                                )}
                                {chosen && <Badge tone="mint" icon={<CheckCheck size={11} />}>Gilt</Badge>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-6">
              <SectionTitle title="Lange nicht bestätigt" sub="Nur eine Quelle, älter als 5 Jahre" right={<Clock3 size={18} className="text-amber-500" />} />
              <div className="space-y-2">
                {stale.map((f) => {
                  const o = personaById(f.owner)!;
                  return (
                    <div key={f.id} className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                      <Avatar p={o} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{f.topic}</div>
                        <div className="text-[11px] text-muted">seit {fmtDate(f.valid_from)} · {o.name}</div>
                      </div>
                      <Button size="sm" variant="soft" onClick={() => toast({ title: "Bestätigung angefragt", body: `${o.name} bekommt die Frage im nächsten Interview.`, tone: "brand" })}>
                        Anfragen
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Pipeline
        open={pipe}
        title={`${upd.id} · ${upd.title_de}`}
        steps={["PDF hochgeladen", "Struktur lesen (Docling)", "Aussagen extrahieren", "Abgleich mit Wissen: UPDATE zu Parken", "Alten Stand als Verlauf sichern"]}
        onDone={() => {
          setPipe(false);
          learn({ text: upd.new_de, owner: "p01", via: "upload", label: `${upd.id} · ${upd.title_de}`, supersedes: upd.changes, validFrom: upd.valid_from, questionIds: ["G01"], topic: "Parkentgelt ab 2027" });
          toast({ title: "UPDATE erkannt", body: `Parken: 10 € → 12 € ab ${fmtDate(upd.valid_from)}. Bis dahin gilt der alte Stand.`, tone: "brand" });
        }}
      />
    </div>
  );
}
