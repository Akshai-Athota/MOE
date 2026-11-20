import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BookCheck, Camera, Check, CircleDot, FileUp, Inbox, Mic, MicOff, MonitorPlay, Send, ShieldCheck, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Pipeline } from "../components/Pipeline";
import { Avatar, Badge, Button, Card, Empty, ProgressRing, QLogo, SectionTitle, Waveform, cx } from "../components/ui";
import { DATA, daysUntil, fmtDate, personaById } from "../lib/data";
import { classifyClaim, redact } from "../lib/engine";
import { useStore } from "../lib/store";
import { useSpeech } from "../lib/useSpeech";
import type { Persona } from "../lib/types";

type Section = "Prozesse & Freigaben" | "Kommunikation" | "Kontakte & Vertretung" | "Projekte & Fristen" | "Ungeschriebene Regeln" | "Neu erfasst";

interface Segment {
  q: string;
  a: string;
  t: string;
  claims: { section: Section; text: string; state: "NEU" | "BESTÄTIGT" | "WIDERSPRUCH" }[];
}

/** Scripted demo for p05 (paraphrases facts F015, F072, F061, F004, F005, F044, F038, F081). */
const SCRIPT: Segment[] = [
  {
    q: "Wolfgang, erzähl mal: Was passiert bei dir, bevor ein Bericht ans LStN rausgeht?",
    a: "Also, das ist so: Der Entwurf kommt aus dem Sachgebiet, die Sachgebietsleitung zeichnet mit, dann schauen wir in der Geschäftsstelle formal drüber, und am Ende zeichnet Frau Wöhler. Und – das steht nirgends – vorher immer kurz die Petra anrufen, die kennt die Leute im Referat.",
    t: "02:14",
    claims: [
      { section: "Prozesse & Freigaben", text: "Berichte ans LStN: Sachgebiet → SGL → Geschäftsstelle (formal) → Vorsteherin.", state: "BESTÄTIGT" },
      { section: "Ungeschriebene Regeln", text: "Vor jedem LStN-Bericht Petra Schulte anrufen – sie kennt das Referat.", state: "NEU" },
    ],
  },
  {
    q: "Du hast mal einen Einspruch erwähnt, der 2023 in der Presse gelandet ist. Was haben wir daraus gelernt?",
    a: "Ach ja, der Fall von Herrn Dieter Konopka, der stand dann in der Zeitung. Seitdem ist ganz klar: Presseanfragen sofort an Frau Wöhler und an Nils weiterleiten, und zu Einzelfällen sagen wir gar nichts – Steuergeheimnis.",
    t: "06:40",
    claims: [{ section: "Kommunikation", text: "Presseanfragen sofort an Vorsteherin und Öffentlichkeitsarbeit; keine Auskunft zu Einzelfällen (§ 30 AO).", state: "BESTÄTIGT" }],
  },
  {
    q: "Wer übernimmt deine Aufgaben, wenn du nicht da bist?",
    a: "Die Sabine, also Frau Krüger. Und der Vertretungsplan liegt auf S, Amt, Organisation – da muss jeder seinen Urlaub über drei Tage eintragen, sonst gibt's Chaos.",
    t: "09:05",
    claims: [
      { section: "Kontakte & Vertretung", text: "Vertretung: Sabine Krüger (Haushalt & Beschaffung).", state: "BESTÄTIGT" },
      { section: "Kontakte & Vertretung", text: "Vertretungsplan: S:\\Amt\\Organisation – Urlaub > 3 Tage eintragen.", state: "NEU" },
    ],
  },
  {
    q: "Was ist beim Umbau der Servicestelle gerade am wichtigsten?",
    a: "Die Ausschreibung muss bis 31. Januar bei der Vergabestelle vom LStN sein, sonst schaffen wir den Baubeginn im Mai nicht. Und vorher muss die Infothek nach 0.04 umziehen. Das wird wieder so ein Durcheinander wie damals mit der Erstattung auf das falsche Konto, DE89 3704 0044 0532 0130 00 – aber das ist eine andere Geschichte.",
    t: "13:31",
    claims: [
      { section: "Projekte & Fristen", text: "Umbau Servicestelle: Vergabeunterlagen bis 31.01.2027 an LStN, sonst kein Baubeginn im Mai.", state: "NEU" },
      { section: "Projekte & Fristen", text: "Abhängigkeit: Infothek muss vorher übergangsweise in Raum 0.04 ziehen.", state: "BESTÄTIGT" },
    ],
  },
  {
    q: "Welche ungeschriebenen Regeln sollte deine Nachfolge unbedingt kennen?",
    a: "Montags vor zehn keine Termine bei der Chefin. Die Kaffeekasse, drei Euro, liegt bei Sabine. Und die Kantine hat seit dem Pächterwechsel im August freitags zu – im Intranet steht das noch falsch!",
    t: "17:52",
    claims: [
      { section: "Ungeschriebene Regeln", text: "Montags vor 10 Uhr keine Termine bei der Vorsteherin.", state: "BESTÄTIGT" },
      { section: "Ungeschriebene Regeln", text: "Kaffeekasse: 3 € im Monat bei Sabine Krüger.", state: "BESTÄTIGT" },
      { section: "Ungeschriebene Regeln", text: "Kantine seit 08/2026 nur Mo–Do 11:30–13:30 – widerspricht dem Intranet.", state: "WIDERSPRUCH" },
    ],
  },
];

const SECTIONS: Section[] = ["Kontakte & Vertretung", "Prozesse & Freigaben", "Projekte & Fristen", "Kommunikation", "Ungeschriebene Regeln", "Neu erfasst"];

function Redacted({ text, caret, limit }: { text: string; caret?: boolean; limit?: number }) {
  // Redact the FULL text first, then reveal progressively, so a secret is never visible half-typed.
  let pos = 0;
  const parts = redact(text).map((p) => {
    const start = pos;
    pos += p.text.length;
    const lim = limit ?? Infinity;
    if (lim <= start) return null;
    return p.redacted ? p : { text: p.text.slice(0, lim - start) };
  });
  return (
    <span className={cx(caret && "caret")}>
      {parts.map((p, i) =>
        !p ? null : p.redacted ? (
          <span key={i} className="mx-0.5 inline-flex items-center gap-1 rounded-lg bg-ink px-1.5 py-0.5 align-middle text-[11px] font-bold text-white" title="Automatisch geschwärzt (§ 30 AO)">
            <ShieldCheck size={11} /> {p.redacted}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

interface Turn {
  q: string;
  a: string;
  t?: string;
  live?: boolean;
}

export default function InterviewView() {
  const { user, openQuestions, learn, toast, engineState } = useStore();
  const me = personaById(user.personaId)!;
  const [done, setDone] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<{ full: string; shown: number } | null>(null);
  const [answering, setAnswering] = useState<{ oqId: string; gapId?: string; q: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [extra, setExtra] = useState<{ section: Section; text: string; state: string }[]>([]);
  const [published, setPublished] = useState(false);
  const [pipe, setPipe] = useState<{ title: string; kind: string } | null>(null);
  const speech = useSpeech((t) => setDraft(t));
  const endRef = useRef<HTMLDivElement>(null);

  const myQs = openQuestions.filter((q) => q.routedTo === me.id);
  const pendingQs = myQs.filter((q) => !q.resolved);
  const claims = useMemo(() => [...SCRIPT.slice(0, done).flatMap((s) => s.claims.map((c) => ({ ...c, t: s.t }))), ...extra.map((e) => ({ ...e, t: "live" }))], [done, extra]);
  const myFacts = DATA.facts.filter((f) => f.owner === me.id);
  const onlyMe = myFacts.filter((f) => !(f.also_known_by ?? []).some((id) => personaById(id)?.status !== "leaving"));
  const captured = Math.min(1, (done / SCRIPT.length) * 0.7 + 0.15 + engineState.learned.filter((f) => f.owner === me.id).length * 0.05);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, streaming?.shown, answering]);

  // typewriter
  useEffect(() => {
    if (!streaming) return;
    if (streaming.shown >= streaming.full.length) {
      const seg = SCRIPT[done];
      setTurns((t) => [...t, { q: seg.q, a: seg.a, t: seg.t }]);
      setStreaming(null);
      setDone((d) => d + 1);
      if (seg.claims.some((c) => c.state === "WIDERSPRUCH")) toast({ title: "Widerspruch erkannt", body: "Kantinenzeiten weichen vom Intranet ab – zur Klärung an die Führungskraft gemeldet.", tone: "amber" });
      if (redact(seg.a).some((p) => p.redacted)) toast({ title: "Steuerdaten geschwärzt", body: "Personenbezogene Steuerdaten wurden vor dem Speichern entfernt (§ 30 AO).", tone: "brand" });
      return;
    }
    const t = setTimeout(() => setStreaming((s) => s && { ...s, shown: Math.min(s.full.length, s.shown + 3) }), 22);
    return () => clearTimeout(t);
  }, [streaming, done, toast]);

  const record = () => {
    if (done >= SCRIPT.length) return;
    setStreaming({ full: SCRIPT[done].a, shown: 0 });
  };

  const startAnswer = (oqId: string) => {
    const oq = myQs.find((q) => q.id === oqId)!;
    setAnswering({ oqId, gapId: oq.gapId, q: oq.text });
    setDraft("");
  };

  const sampleAnswer = () => {
    const gap = DATA.plants.planted_gaps.find((g) => g.id === answering?.gapId);
    if (gap?.live_demo_answer_de) setDraft(gap.live_demo_answer_de);
  };

  const saveAnswer = () => {
    if (!draft.trim()) return;
    speech.stop();
    const q = answering?.q ?? "Freie Notiz";
    const cls = classifyClaim(draft, engineState);
    learn({ text: draft, owner: me.id, via: "interview", label: `Interview ${me.name.split(" ")[0][0]}. ${me.name.split(" ").slice(-1)[0]} · live`, gapId: answering?.gapId, topic: answering ? q.replace("?", "") : undefined });
    setTurns((t) => [...t, { q, a: draft, live: true }]);
    setExtra((e) => [...e, { section: "Neu erfasst", text: draft.length > 110 ? draft.slice(0, 107) + "…" : draft, state: cls.kind === "SAME" ? "BESTÄTIGT" : "NEU" }]);
    toast({
      title: answering?.gapId ? "Wissenslücke geschlossen 🎉" : "Gespeichert",
      body: answering?.gapId ? "Die Antwort ist sofort in Q durchsuchbar. Die fragende Person wird benachrichtigt." : `Abgleich: ${cls.kind}`,
      tone: "mint",
    });
    setAnswering(null);
    setDraft("");
  };

  const sectionsWithClaims = SECTIONS.map((s) => ({ s, items: claims.filter((c) => c.section === s) }));
  const covered = sectionsWithClaims.filter((x) => x.items.length > 0 && x.s !== "Neu erfasst").length;

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Wissensinterview"
        title="Dein Wissen bleibt im Amt"
        sub="Einfach erzählen – Q strukturiert, schwärzt Steuerdaten und baut daraus dein Übergabe-Handbuch. Kein Schreiben nötig."
      />
      <div className="space-y-6 px-5 lg:px-8">
        {/* Status strip */}
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_1fr]">
          <Card className="flex items-center gap-5 p-5">
            <ProgressRing value={captured} size={76} stroke={8} color="#573CFA" track="#EAE6FF">
              <span className="text-[17px] font-extrabold text-brand-600">{Math.round(captured * 100)}%</span>
            </ProgressRing>
            <div>
              <div className="font-bold">Wissen gesichert</div>
              <div className="text-[13px] text-muted">
                Sitzung {Math.min(4, 2 + Math.floor(done / 3))} von 4 · noch <b className="text-coral-600">{daysUntil(me.leave_date!)} Tage</b> bis {fmtDate(me.leave_date)}
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] text-muted">Nur in deinem Kopf</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-extrabold">{onlyMe.length}</span>
              <span className="pb-1 text-[13px] text-muted">Themen ohne zweite Quelle</span>
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] text-muted">Fragen von Kolleg:innen</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-extrabold text-coral-500">{pendingQs.length}</span>
              <span className="pb-1 text-[13px] text-muted">warten auf dich</span>
            </div>
          </Card>
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[1fr_420px]">
          {/* Conversation */}
          <Card className="flex h-[720px] flex-col overflow-hidden xl:sticky xl:top-4">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <QLogo size={36} />
              <div className="flex-1">
                <div className="font-bold">Q interviewt dich</div>
                <div className="text-[12px] text-muted">Stil: erst Geschichten, dann Details – angepasst an dich</div>
              </div>
              <Badge tone="mint" icon={<CircleDot size={10} />}>
                Live
              </Badge>
            </div>

            <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto bg-dots p-5">
              {turns.length === 0 && !streaming && (
                <div className="mx-auto max-w-md rounded-3xl bg-white p-5 text-center shadow-soft">
                  <div className="text-[15px] font-bold">Schön, dass du dir Zeit nimmst, {me.name.split(" ")[0]}!</div>
                  <p className="mt-1 text-[13px] text-muted">Wir machen 10 Minuten. Ich frage, du erzählst – so wie du es einem Neuen beim Kaffee erklären würdest.</p>
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="space-y-3">
                  <QBubble text={t.q} />
                  <MeBubble me={me} text={t.a} t={t.t} live={t.live} />
                </div>
              ))}
              {streaming && (
                <div className="space-y-3">
                  <QBubble text={SCRIPT[done].q} />
                  <MeBubble me={me} text={streaming.full} limit={streaming.shown} streaming />
                </div>
              )}
              {!streaming && !answering && done < SCRIPT.length && <QBubble text={SCRIPT[done].q} pending />}
              {answering && <QBubble text={`Frage aus dem Team: „${answering.q}“`} pending highlight />}
              <div ref={endRef} />
            </div>

            {/* Controls */}
            <div className="border-t border-line p-4">
              {answering || done >= SCRIPT.length ? (
                <div className="space-y-2.5">
                  <div className="flex items-end gap-2 rounded-[22px] border border-line bg-canvas p-2 focus-within:border-brand-300 focus-within:bg-white">
                    {speech.supported && (
                      <button
                        onClick={speech.listening ? speech.stop : speech.start}
                        className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", speech.listening ? "bg-coral-500 text-white" : "bg-white text-muted hover:text-brand-600")}
                        aria-label="Sprechen"
                      >
                        {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
                      </button>
                    )}
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      placeholder={answering ? "Erzähl oder tippe deine Antwort …" : "Noch etwas, das niemand vergessen darf? Erzähl es Q …"}
                      className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] outline-none"
                    />
                    <Button onClick={saveAnswer} disabled={!draft.trim()} icon={<Send size={15} />}>
                      Speichern
                    </Button>
                  </div>
                  {draft && (
                    <div className="rounded-2xl bg-white px-3 py-2 text-[12px] text-muted ring-1 ring-line">
                      Vorschau nach Schwärzung: <Redacted text={draft} />
                    </div>
                  )}
                  {answering && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="soft" onClick={sampleAnswer}>
                        Demo-Antwort einsprechen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAnswering(null)}>
                        Später
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={record}
                    disabled={!!streaming}
                    className={cx(
                      "grid h-14 w-14 shrink-0 place-items-center rounded-full text-white transition",
                      streaming ? "bg-coral-500 ring-8 ring-coral-100" : "bg-brand-500 shadow-glow hover:scale-105",
                    )}
                    aria-label="Antwort aufnehmen"
                  >
                    {streaming ? <Square size={18} fill="currentColor" /> : <Mic size={22} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{streaming ? "Ich höre zu …" : "Antwort aufnehmen"}</div>
                    <Waveform active={!!streaming} bars={40} className="h-8" />
                  </div>
                  <Badge tone="gray">
                    Frage {done + 1}/{SCRIPT.length}
                  </Badge>
                </div>
              )}
            </div>
          </Card>

          {/* Handbook */}
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="bg-hero p-5 text-white">
                <div className="flex items-center justify-between">
                  <Badge tone="dark" className="!bg-white/15 !text-white !ring-white/20">
                    <BookCheck size={11} /> Handbuchseite – entsteht live
                  </Badge>
                  {published && <Badge tone="mint">Veröffentlicht</Badge>}
                </div>
                <div className="mt-3 text-lg font-extrabold">Leitung Geschäftsstelle</div>
                <div className="text-[13px] text-white/75">
                  Wissen von {me.name} · {covered}/5 Bereiche
                </div>
              </div>
              <div className="scroll-thin max-h-[440px] space-y-4 overflow-y-auto p-5">
                {sectionsWithClaims.map(({ s, items }) =>
                  s === "Neu erfasst" && !items.length ? null : (
                    <div key={s}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12px] font-bold uppercase tracking-wide text-muted">{s}</span>
                        {items.length === 0 && <Badge tone="amber">fehlt noch</Badge>}
                      </div>
                      <AnimatePresence>
                        {items.map((c) => (
                          <motion.div
                            key={c.text}
                            initial={{ opacity: 0, x: 12, backgroundColor: "#EAE6FF" }}
                            animate={{ opacity: 1, x: 0, backgroundColor: "#ffffff" }}
                            transition={{ duration: 0.6 }}
                            className="mb-1.5 flex gap-2.5 rounded-2xl border border-line p-2.5"
                          >
                            <span
                              className={cx(
                                "mt-0.5 h-fit shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide",
                                c.state === "NEU" ? "bg-mint-50 text-mint-700" : c.state === "WIDERSPRUCH" ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-600",
                              )}
                            >
                              {c.state}
                            </span>
                            <div className="min-w-0 flex-1 text-[13px] leading-snug">
                              <Redacted text={c.text} />
                              <div className="mt-1 text-[11px] font-semibold text-brand-500">▶ {c.t === "live" ? "Live-Antwort" : `Interview ${c.t}`}</div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  ),
                )}
              </div>
              <div className="border-t border-line p-4">
                <Button
                  className="w-full"
                  disabled={claims.length < 3 || published}
                  onClick={() => {
                    setPublished(true);
                    toast({ title: "Handbuchseite veröffentlicht", body: `${claims.length} Aussagen indexiert – sofort in „Frag Q“ durchsuchbar.`, tone: "mint" });
                  }}
                  icon={<Check size={16} />}
                >
                  {published ? "Veröffentlicht" : "Prüfen & freigeben"}
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle title="Kolleg:innen fragen dich" sub="Fragen, die Q nicht beantworten konnte" right={<Inbox size={18} className="text-coral-500" />} />
              {myQs.length === 0 ? (
                <Empty icon={<Sparkles size={18} />} title="Keine offenen Fragen" />
              ) : (
                <div className="space-y-2">
                  {myQs.map((q) => {
                    const by = personaById(q.askedBy)!;
                    return (
                      <div key={q.id} className={cx("rounded-2xl border p-3 transition", q.resolved ? "border-mint-100 bg-mint-50/50" : "border-line")}>
                        <div className="flex items-start gap-2.5">
                          <Avatar p={by} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold leading-snug">{q.text}</div>
                            <div className="text-[11px] text-muted">
                              {by.name} · {fmtDate(q.askedAt)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex justify-end">
                          {q.resolved ? (
                            <Badge tone="mint" icon={<Check size={11} />}>
                              Beantwortet
                            </Badge>
                          ) : (
                            <Button size="sm" variant={answering?.oqId === q.id ? "soft" : "primary"} onClick={() => startAnswer(q.id)}>
                              {answering?.oqId === q.id ? "Wird beantwortet …" : "Jetzt beantworten"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <SectionTitle title="Auch so kannst du Wissen teilen" />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: "video", t: "Bildschirm aufnehmen", icon: MonitorPlay },
                  { k: "photo", t: "Whiteboard fotografieren", icon: Camera },
                  { k: "doc", t: "Dokument hochladen", icon: FileUp },
                ].map((m) => (
                  <button
                    key={m.k}
                    onClick={() => setPipe({ title: m.t, kind: m.k })}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-line p-3 text-center text-[12px] font-semibold transition hover:border-brand-200 hover:bg-brand-50"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-500">
                      <m.icon size={18} />
                    </span>
                    {m.t}
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Pipeline
        open={!!pipe}
        title={pipe?.title ?? ""}
        steps={
          pipe?.kind === "photo"
            ? ["Foto hochgeladen", "Texterkennung (OCR)", "Struktur erkennen: Organigramm", "Steuerdaten schwärzen", "Aussagen extrahieren & abgleichen"]
            : pipe?.kind === "video"
              ? ["Video hochgeladen", "Audio transkribieren (Whisper)", "Schlüsselbilder beschreiben", "Steuerdaten schwärzen", "Aussagen extrahieren & abgleichen"]
              : ["Dokument hochgeladen", "Struktur lesen (Docling)", "Steuerdaten schwärzen", "Aussagen extrahieren & abgleichen"]
        }
        onDone={() => {
          const k = pipe?.kind;
          setPipe(null);
          const text =
            k === "photo"
              ? "Organigramm: Rechtsbehelfsstelle (Hartmann), Geschäftsstelle (Reinecke), Arbeitnehmerbereich (Schulte) – alle berichten an die Vorsteherin."
              : k === "video"
                ? "Bildschirmvideo: Bedarfsmeldung über das Formular auf S:\\Amt\\Formulare bis zum 15. des Monats."
                : "Dokument: Formalprüfung von LStN-Berichten durch die Geschäftsstelle vor Zeichnung.";
          setExtra((e) => [...e, { section: "Neu erfasst", text, state: "BESTÄTIGT" }]);
          toast({ title: "Verarbeitet", body: "1 Aussage erkannt – bestätigt vorhandenes Wissen (SAME).", tone: "mint" });
        }}
      />
    </div>
  );
}

function QBubble({ text, pending, highlight }: { text: string; pending?: boolean; highlight?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <QLogo size={30} />
      <div
        className={cx(
          "max-w-[85%] rounded-3xl rounded-tl-md px-4 py-3 text-[14px] shadow-soft",
          highlight ? "bg-coral-50 ring-1 ring-coral-100" : "bg-white",
          pending && "ring-2 ring-brand-200",
        )}
      >
        {highlight && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-coral-600">
            <AlertTriangle size={11} /> Wissenslücke
          </div>
        )}
        {text}
      </div>
    </motion.div>
  );
}

function MeBubble({ me, text, t, streaming, live, limit }: { me: Persona; text: string; t?: string; streaming?: boolean; live?: boolean; limit?: number }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <Avatar p={me} size={30} />
      <div className="max-w-[85%] rounded-3xl rounded-tr-md bg-brand-500 px-4 py-3 text-[14px] leading-relaxed text-white shadow-glow [&_.caret]:after:text-white">
        <Redacted text={text} caret={streaming} limit={limit} />
        {(t || live) && <div className="mt-1.5 text-[11px] font-semibold text-white/70">{live ? "● live aufgenommen" : `▶ ${t}`}</div>}
      </div>
    </div>
  );
}
