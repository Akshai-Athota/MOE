import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BookHeart, Check, Gift, Heart, Lightbulb, Mic, MicOff, PartyPopper, Printer, Quote, RotateCcw, Sparkles, Trophy, Users, User, X } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CitationChip } from "../components/Sources";
import { Avatar, Badge, Button, Card, Drawer, QLogo, SectionTitle, cx } from "../components/ui";
import { CATEGORIES, DATA, TODAY, daysUntil, fmtDate, personaById } from "../lib/data";
import { citationFor } from "../lib/engine";
import { useStore } from "../lib/store";
import type { Persona, QuizQuestion } from "../lib/types";
import { useSpeech } from "../lib/useSpeech";

const BRAND_CONFETTI = ["#573CFA", "#8F78FC", "#FF7A59", "#FFB4A0", "#12B886", "#F5A524"];
const burst = (power = 1) => {
  confetti({ particleCount: 90 * power, spread: 75, origin: { y: 0.65 }, colors: BRAND_CONFETTI, scalar: 1.05 });
  if (power > 1) {
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: BRAND_CONFETTI }), 200);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: BRAND_CONFETTI }), 350);
  }
};

const TEAMS = ["Team Innerste", "Team Galgenberg", "Team Herta"];

type Phase = "setup" | "play" | "end";

export default function CelebrationView() {
  const { user } = useStore();
  const leaverIds = Object.keys(DATA.quiz.leavers).filter((id) => user.role === "manager" || id === user.personaId);
  const [leaverId, setLeaverId] = useState(leaverIds[0]);
  const [mode, setMode] = useState<"party" | "solo">(DATA.quiz.leavers[leaverIds[0]].mode);
  const [phase, setPhase] = useState<Phase>("setup");
  const [stats, setStats] = useState({ scores: [0, 0, 0], gaps: 0, stories: 0 });
  const leaver = personaById(leaverId)!;

  const start = () => {
    setStats({ scores: [0, 0, 0], gaps: 0, stories: 0 });
    setPhase("play");
  };

  return (
    <div className="pb-10">
      {phase === "setup" && (
        <>
          <PageHeader eyebrow="Abschied mit Q" title="Ein Abschied, bei dem das Wissen bleibt" sub="Ein Quiz aus dem Wissen der Person, die geht: Kolleg:innen raten, sie erzählt die Geschichte dazu – und was niemand weiß, hält Q live fest." />
          <Setup leaverIds={leaverIds} leaverId={leaverId} setLeaverId={(id) => { setLeaverId(id); setMode(DATA.quiz.leavers[id].mode); }} mode={mode} setMode={setMode} onStart={start} />
        </>
      )}
      {phase === "play" && <Play leaver={leaver} mode={mode} onEnd={(s) => { setStats(s); setPhase("end"); burst(2); }} onExit={() => setPhase("setup")} />}
      {phase === "end" && <End leaver={leaver} mode={mode} stats={stats} onRestart={() => setPhase("setup")} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Setup({ leaverIds, leaverId, setLeaverId, mode, setMode, onStart }: { leaverIds: string[]; leaverId: string; setLeaverId: (id: string) => void; mode: "party" | "solo"; setMode: (m: "party" | "solo") => void; onStart: () => void }) {
  const qs = DATA.quiz.questions.filter((q) => q.leaver === leaverId);
  const leaver = personaById(leaverId)!;
  return (
    <div className="space-y-6 px-5 lg:px-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-party relative overflow-hidden rounded-[32px] p-6 text-white lg:p-9">
        <motion.div className="pointer-events-none absolute -right-6 top-6 text-[120px] leading-none opacity-20" animate={{ rotate: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 4 }}>
          🎉
        </motion.div>
        <div className="relative max-w-2xl">
          <Badge tone="dark" className="!bg-white/20 !text-white !ring-white/25">
            <PartyPopper size={11} /> Letzter Arbeitstag: {fmtDate(leaver.leave_date)} · in {daysUntil(leaver.leave_date!)} Tagen
          </Badge>
          <h2 className="mt-4 text-[30px] font-extrabold leading-[1.1] lg:text-[42px]">Danke für {leaver.tenure_years} Jahre, {leaver.name.split(" ")[0]}!</h2>
          <p className="mt-3 max-w-xl text-[15px] text-white/85">
            Nicht „bitte dokumentier alles“ – sondern eine Feier, bei der {leaver.name.split(" ")[0]} die Hauptperson ist. Lustige Fragen zum Mitraten, dazwischen Wissenslücken, die nur {leaver.name.split(" ")[0]} schließen kann.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="white" size="lg" onClick={onStart} icon={<Sparkles size={18} />}>
              Quiz starten
            </Button>
            <span className="text-[13px] text-white/80">
              {qs.filter((q) => q.type === "funny").length} lustige Fragen · {qs.filter((q) => q.type === "gap").length} Wissenslücken · ca. {DATA.quiz.settings.modes[mode].duration_min} Min.
            </span>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <SectionTitle title="Für wen ist die Feier?" />
          <div className="space-y-3">
            {leaverIds.map((id) => {
              const p = personaById(id)!;
              const on = id === leaverId;
              return (
                <button key={id} onClick={() => setLeaverId(id)} className={cx("flex w-full items-center gap-4 rounded-3xl border-2 p-4 text-left transition", on ? "border-brand-500 bg-brand-50/60" : "border-line hover:border-brand-200")}>
                  <Avatar p={p} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{p.name}</div>
                    <div className="truncate text-[12px] text-muted">
                      {p.role_de.split("(")[0]} · {p.tenure_years} Jahre
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(p.interests ?? []).slice(0, 3).map((i) => (
                        <Badge key={i} tone="gray">
                          {i}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-extrabold text-coral-500">{daysUntil(p.leave_date!)}</div>
                    <div className="text-[11px] text-muted">Tage</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle title="Format" sub={`Vorliebe von ${leaver.name.split(" ")[0]}: ${leaver.celebration_preference === "party" ? "große Runde" : "lieber in Ruhe"}`} />
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { k: "party", icon: Users, t: "Party", d: "Großer Bildschirm, Teams raten mit, Punkte für die Kolleg:innen." },
                { k: "solo", icon: User, t: "Solo", d: "Ruhiges Gespräch zu zweit mit Q – ohne Publikum." },
              ] as const
            ).map((m) => (
              <button key={m.k} onClick={() => setMode(m.k)} className={cx("rounded-3xl border-2 p-4 text-left transition", mode === m.k ? "border-brand-500 bg-brand-50/60" : "border-line hover:border-brand-200")}>
                <div className={cx("grid h-11 w-11 place-items-center rounded-2xl", mode === m.k ? "bg-brand-500 text-white" : "bg-canvas text-muted")}>
                  <m.icon size={20} />
                </div>
                <div className="mt-3 font-bold">{m.t}</div>
                <div className="mt-1 text-[12px] text-muted">{m.d}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            {[
              { icon: Lightbulb, t: "Lustige Fragen", d: `Kolleg:innen raten, ${leaver.name.split(" ")[0]} erzählt die Geschichte.` },
              { icon: Heart, t: "Wissenslücken", d: `Fragen, die nur ${leaver.name.split(" ")[0]} beantworten kann.` },
              { icon: BookHeart, t: "Bleibendes", d: "Booklet, Geschenk & Nennung in jeder Q-Antwort." },
            ].map((x) => (
              <div key={x.t} className="rounded-2xl bg-canvas p-3">
                <x.icon size={18} className="text-brand-500" />
                <div className="mt-1.5 text-[13px] font-bold">{x.t}</div>
                <div className="text-[11px] text-muted">{x.d}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Play({ leaver, mode, onEnd, onExit }: { leaver: Persona; mode: "party" | "solo"; onEnd: (s: { scores: number[]; gaps: number; stories: number }) => void; onExit: () => void }) {
  const { learn, toast } = useStore();
  const qs = useMemo(() => DATA.quiz.questions.filter((q) => q.leaver === leaver.id), [leaver.id]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [awarded, setAwarded] = useState(false);
  const [scores, setScores] = useState([0, 0, 0]);
  const [gaps, setGaps] = useState(0);
  const [gapStage, setGapStage] = useState<"ask" | "record" | "saved">("ask");
  const [answer, setAnswer] = useState("");
  const speech = useSpeech((t) => setAnswer(t));
  const q: QuizQuestion = qs[i];
  const first = leaver.name.split(" ")[0];
  const fact = q.answer_fact ? DATA.facts.find((f) => f.id === q.answer_fact) : undefined;
  const gap = q.gap_id ? DATA.plants.planted_gaps.find((g) => g.id === q.gap_id) : undefined;

  const next = () => {
    if (i + 1 >= qs.length) return onEnd({ scores, gaps, stories: qs.filter((x) => x.type === "funny").length });
    setI(i + 1);
    setPicked(null);
    setAwarded(false);
    setGapStage("ask");
    setAnswer("");
  };

  const pick = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    if (k === q.answer) burst(0.6);
  };

  const saveGap = () => {
    speech.stop();
    learn({
      text: answer,
      owner: leaver.id,
      via: "quiz",
      label: `Abschiedsquiz ${first[0]}. ${leaver.name.split(" ").slice(-1)[0]} · ${fmtDate(TODAY)}`,
      gapId: q.gap_id,
      topic: q.question_de.replace("?", ""),
    });
    setGaps((g) => g + 1);
    setGapStage("saved");
    burst(1.2);
    toast({ title: "Wissen gesichert 💜", body: `„${q.question_de}“ ist ab sofort in Q beantwortbar – mit ${first} als Quelle.`, tone: "mint" });
  };

  return (
    <div className="px-5 pt-6 lg:px-8 lg:pt-8">
      <div className="bg-party relative overflow-hidden rounded-[36px] p-4 sm:p-6 lg:p-8">
        {/* top bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3">
            <Avatar p={leaver} size={44} ring />
            <div>
              <div className="text-[12px] font-semibold text-white/75">Abschiedsquiz · {mode === "party" ? "Party" : "Solo"}</div>
              <div className="font-extrabold">{leaver.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {qs.map((x, k) => (
              <span key={x.id} className={cx("h-2.5 rounded-full transition-all", k === i ? "w-7 bg-white" : k < i ? "w-2.5 bg-white/80" : "w-2.5 bg-white/30", x.type === "gap" && k >= i && "ring-2 ring-coral-100/70")} />
            ))}
          </div>
          <button onClick={onExit} className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15 hover:bg-white/25" aria-label="Beenden">
            <X size={18} />
          </button>
        </div>

        <div className={cx("grid gap-5", mode === "party" && "lg:grid-cols-[1fr_260px]")}>
          <AnimatePresence mode="wait">
            <motion.div key={q.id} initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} transition={{ type: "spring", stiffness: 300, damping: 28 }} className="rounded-[30px] bg-white p-5 shadow-2xl sm:p-8">
              <div className="flex items-center justify-between">
                {q.type === "funny" ? (
                  <Badge tone="brand" icon={<Lightbulb size={11} />}>Lustige Frage · {i + 1}/{qs.length}</Badge>
                ) : (
                  <Badge tone="coral" icon={<Heart size={11} />}>Wissenslücke – nur {first} weiß es</Badge>
                )}
                {fact && <span className="hidden text-[12px] text-muted sm:block">{CATEGORIES[fact.category]?.de}</span>}
              </div>

              {q.type === "gap" && (
                <div className="mt-5 flex gap-3">
                  <QLogo size={40} />
                  <div className="rounded-3xl rounded-tl-md bg-canvas px-4 py-3 text-[15px] font-medium">{q.host_line_de}</div>
                </div>
              )}

              <h2 className="mt-5 text-[24px] font-extrabold leading-tight sm:text-[30px]">{q.question_de}</h2>

              {q.type === "funny" && (
                <>
                  <div className="mt-6 grid gap-3">
                    {q.options!.map((o, k) => {
                      const right = picked !== null && k === q.answer;
                      const wrong = picked === k && k !== q.answer;
                      return (
                        <motion.button
                          key={o}
                          whileHover={picked === null ? { scale: 1.01 } : undefined}
                          whileTap={picked === null ? { scale: 0.98 } : undefined}
                          onClick={() => pick(k)}
                          className={cx(
                            "flex items-center gap-4 rounded-3xl border-2 p-4 text-left text-[16px] font-semibold transition",
                            right ? "border-mint-500 bg-mint-50" : wrong ? "border-rose-500 bg-rose-50" : picked !== null ? "border-line opacity-50" : "border-line hover:border-brand-300 hover:bg-brand-50/50",
                          )}
                        >
                          <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[15px] font-extrabold", right ? "bg-mint-500 text-white" : wrong ? "bg-rose-500 text-white" : "bg-brand-50 text-brand-600")}>
                            {right ? <Check size={18} /> : wrong ? <X size={18} /> : String.fromCharCode(65 + k)}
                          </span>
                          {o}
                        </motion.button>
                      );
                    })}
                  </div>
                  <AnimatePresence>
                    {picked !== null && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                        <div className="mt-5 rounded-3xl bg-gradient-to-br from-coral-50 to-brand-50 p-5">
                          <div className="flex items-center gap-2 text-[13px] font-extrabold text-coral-600">
                            <Mic size={15} /> {first}, erzähl!
                          </div>
                          <div className="mt-1 text-[18px] font-bold">{q.reveal_prompt_de}</div>
                          {fact && (
                            <div className="mt-3 flex gap-2 text-[13px] text-ink/75">
                              <Quote size={14} className="mt-0.5 shrink-0 text-brand-300" />
                              {fact.de}
                            </div>
                          )}
                        </div>
                        {mode === "party" && !awarded && (
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold text-muted">Punkt für:</span>
                            {TEAMS.map((t, k) => (
                              <Button
                                key={t}
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setScores((s) => s.map((v, j) => (j === k ? v + 1 : v)));
                                  setAwarded(true);
                                }}
                              >
                                {t}
                              </Button>
                            ))}
                            <Button size="sm" variant="ghost" onClick={() => setAwarded(true)}>
                              Niemand
                            </Button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {q.type === "gap" && (
                <div className="mt-6">
                  {gapStage === "ask" && (
                    <div className="flex flex-wrap gap-3">
                      <Button variant="coral" size="lg" onClick={() => setGapStage("record")} icon={<Mic size={18} />}>
                        Niemand weiß es – {first}, übernimmst du?
                      </Button>
                    </div>
                  )}
                  {gapStage === "record" && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <div className="flex items-end gap-2 rounded-[24px] border-2 border-coral-100 bg-coral-50/40 p-2 focus-within:border-coral-500">
                        {speech.supported && (
                          <button onClick={speech.listening ? speech.stop : speech.start} className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", speech.listening ? "bg-coral-500 text-white" : "bg-white text-coral-500")} aria-label="Sprechen">
                            {speech.listening ? <MicOff size={19} /> : <Mic size={19} />}
                          </button>
                        )}
                        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder={`${first} erzählt … (Q hört mit)`} className="flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="coral" onClick={saveGap} disabled={!answer.trim()} icon={<Check size={16} />}>
                          Als Wissen speichern
                        </Button>
                        {gap?.live_demo_answer_de && (
                          <Button variant="soft" onClick={() => setAnswer(gap.live_demo_answer_de!)}>
                            Demo-Antwort
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  )}
                  {gapStage === "saved" && (
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex gap-4 rounded-3xl bg-mint-50 p-5 ring-1 ring-mint-100">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mint-500 text-white">
                        <Check size={22} />
                      </div>
                      <div>
                        <div className="font-extrabold text-mint-700">Wissenslücke geschlossen!</div>
                        <div className="mt-0.5 text-[13px] text-ink/75">„{answer}“</div>
                        <div className="mt-2 text-[12px] font-semibold text-mint-700">Quelle: Abschiedsquiz {leaver.name} · {fmtDate(TODAY)}</div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <Button onClick={next} disabled={q.type === "funny" ? picked === null || (mode === "party" && !awarded) : gapStage !== "saved"} icon={i + 1 >= qs.length ? <PartyPopper size={16} /> : undefined}>
                  {i + 1 >= qs.length ? "Zum großen Finale" : "Nächste Frage"} {i + 1 < qs.length && <ArrowRight size={16} />}
                </Button>
              </div>
            </motion.div>
          </AnimatePresence>

          {mode === "party" && (
            <div className="space-y-3">
              <div className="rounded-[28px] bg-white/15 p-4 text-white ring-1 ring-white/25 backdrop-blur">
                <div className="mb-3 flex items-center gap-2 text-[13px] font-bold">
                  <Trophy size={15} /> Punktestand
                </div>
                {TEAMS.map((t, k) => {
                  const max = Math.max(1, ...scores);
                  return (
                    <div key={t} className="mb-2.5">
                      <div className="mb-1 flex justify-between text-[13px] font-semibold">
                        <span>{t}</span>
                        <span>{scores[k]}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/20">
                        <motion.div className="h-full rounded-full bg-white" animate={{ width: `${(scores[k] / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-[28px] bg-white/15 p-4 text-[13px] text-white ring-1 ring-white/25 backdrop-blur">
                <div className="font-bold">💜 {gaps} Wissenslücke{gaps === 1 ? "" : "n"} geschlossen</div>
                <div className="mt-1 text-white/80">{first} bekommt keine Punkte – {first} ist heute der Experte.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function End({ leaver, mode, stats, onRestart }: { leaver: Persona; mode: "party" | "solo"; stats: { scores: number[]; gaps: number; stories: number }; onRestart: () => void }) {
  const { user, engineState, toast } = useStore();
  const [booklet, setBooklet] = useState(false);
  const first = leaver.name.split(" ")[0];
  const winner = stats.scores.indexOf(Math.max(...stats.scores));
  const isSelf = user.personaId === leaver.id;
  const gifts = DATA.quiz.rewards.suggestions[leaver.id] ?? [];
  const taxFact = DATA.facts.find((f) => f.id === DATA.quiz.rewards.tax_fact)!;
  const facts = [...DATA.facts.filter((f) => f.owner === leaver.id && f.status !== "superseded" && f.access !== "restricted"), ...engineState.learned.filter((f) => f.owner === leaver.id)];
  const byCat = Object.entries(
    facts.reduce<Record<string, typeof facts>>((a, f) => {
      (a[f.category] ??= []).push(f);
      return a;
    }, {}),
  );
  const sampleFact = engineState.learned.find((f) => f.owner === leaver.id) ?? facts[0];

  return (
    <div className="space-y-6 px-5 pt-6 lg:px-8 lg:pt-8">
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="bg-party relative overflow-hidden rounded-[36px] p-8 text-center text-white lg:p-12">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }} className="mx-auto w-fit">
          <Avatar p={leaver} size={96} ring />
        </motion.div>
        <h2 className="mt-5 text-[34px] font-extrabold lg:text-[46px]">Danke, {first}! 💜</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-white/85">
          {leaver.tenure_years} Jahre Erfahrung – und ab heute hilft dein Wissen jeder neuen Kollegin und jedem neuen Kollegen. Q nennt dich bei jeder Antwort als Quelle.
        </p>
        <div className="mx-auto mt-7 grid max-w-2xl grid-cols-3 gap-3">
          {[
            { v: stats.stories, l: "Geschichten erzählt" },
            { v: stats.gaps, l: "Wissenslücken geschlossen" },
            { v: facts.length, l: "Einträge im Booklet" },
          ].map((x) => (
            <div key={x.l} className="rounded-3xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur">
              <div className="text-3xl font-extrabold">{x.v}</div>
              <div className="text-[12px] text-white/80">{x.l}</div>
            </div>
          ))}
        </div>
        {mode === "party" && Math.max(...stats.scores) > 0 && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-brand-700">
            <Trophy size={15} /> {TEAMS[winner]} gewinnt mit {stats.scores[winner]} Punkten
          </div>
        )}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-500">
            <BookHeart size={22} />
          </div>
          <div className="mt-4 text-lg font-extrabold">„Wissen von {first}“</div>
          <p className="mt-1 text-[13px] text-muted">Das persönliche Booklet mit allem, was {first} weitergegeben hat – zum Ausdrucken und Mitnehmen.</p>
          <Button className="mt-auto w-full" onClick={() => setBooklet(true)} icon={<BookHeart size={16} />}>
            Booklet öffnen
          </Button>
        </Card>

        <Card className="flex flex-col p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-coral-50 text-coral-500">
            <Gift size={22} />
          </div>
          <div className="mt-4 text-lg font-extrabold">Geschenkidee</div>
          {isSelf ? (
            <p className="mt-1 text-[13px] text-muted">Psst – das ist eine Überraschung. 🤫 Deine Kolleg:innen kümmern sich darum.</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-muted">Aus Interessen, die {first} selbst im Interview genannt hat.</p>
              <div className="mt-3 space-y-2">
                {gifts.map((g) => (
                  <div key={g.de} className="flex items-center justify-between gap-2 rounded-2xl bg-canvas p-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">{g.de}</div>
                      <div className="text-[11px] text-muted">weil: {g.based_on}</div>
                    </div>
                    <Badge tone="mint">≈ {g.est_eur} €</Badge>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-100">
                <b>Lohnsteuer-Check:</b> {taxFact.de.split(":")[1]?.split(".")[0]}.
              </div>
              <Button variant="coral" className="mt-4 w-full" onClick={() => toast({ title: "Vorschlag gesendet", body: "Die Geschäftsstelle organisiert das Geschenk.", tone: "coral" })}>
                An Orga senden
              </Button>
            </>
          )}
        </Card>

        <Card className="flex flex-col p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-mint-50 text-mint-500">
            <Sparkles size={22} />
          </div>
          <div className="mt-4 text-lg font-extrabold">Für immer zitiert</div>
          <p className="mt-1 text-[13px] text-muted">Wenn Kolleg:innen künftig fragen, antwortet Q mit {first}s Wissen – und nennt die Quelle:</p>
          {sampleFact && (
            <div className="mt-3 rounded-2xl border border-line p-3">
              <p className="line-clamp-3 text-[13px]">{sampleFact.de}</p>
              <div className="mt-2">
                <CitationChip c={citationFor(sampleFact)} n={1} onClick={() => {}} />
              </div>
            </div>
          )}
          <Button variant="outline" className="mt-auto w-full" onClick={onRestart} icon={<RotateCcw size={15} />}>
            Neue Feier planen
          </Button>
        </Card>
      </div>

      <Drawer open={booklet} onClose={() => setBooklet(false)} title="Booklet" wide>
        <div id="booklet" className="space-y-6">
          <div className="bg-party rounded-[28px] p-6 text-white">
            <div className="text-[12px] font-bold uppercase tracking-widest text-white/80">Finanzamt Hildesheim · {fmtDate(TODAY)}</div>
            <div className="mt-2 text-3xl font-extrabold">Wissen von {leaver.name}</div>
            <div className="mt-1 text-white/85">
              {leaver.role_de} · {leaver.tenure_years} Jahre
            </div>
          </div>
          {byCat.map(([cat, fs]) => (
            <div key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORIES[cat]?.color }} />
                <span className="text-[13px] font-extrabold uppercase tracking-wide">{CATEGORIES[cat]?.de}</span>
              </div>
              <div className="space-y-2">
                {fs.map((f) => (
                  <div key={f.id} className="rounded-2xl border border-line p-3.5">
                    <div className="text-[13px] font-bold">{f.topic}</div>
                    <div className="mt-0.5 text-[13px] text-ink/80">{f.de}</div>
                    {f.learned && <div className="mt-1 text-[11px] font-semibold text-mint-700">♥ {f.learned.label}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-2xl bg-brand-50 p-4 text-center text-[13px] text-brand-700">Danke, dass du dein Wissen geteilt hast. – Dein Team & Q</div>
        </div>
        <Button className="mt-6 w-full" onClick={() => window.print()} icon={<Printer size={16} />}>
          Drucken / als PDF speichern
        </Button>
      </Drawer>
    </div>
  );
}
