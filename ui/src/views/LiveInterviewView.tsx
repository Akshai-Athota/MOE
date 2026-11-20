/**
 * Knowledge interview on the real backend (hilde/interview.py): Q plans the questions, the answer is
 * redacted on the server, statements are extracted and compared with existing knowledge, and the
 * handbook page is published after the person approved it.
 */
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BookCheck, Check, CircleDot, Inbox, Mic, MicOff, Send, ShieldCheck, SkipForward, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Avatar, Badge, Button, Card, Empty, ProgressRing, QLogo, SectionTitle, cx } from "../components/ui";
import { DATA, daysUntil, fmtDate, personaById } from "../lib/data";
import { interviewApi, type IvClaim, type IvQuestion, type IvSession } from "../lib/api";
import { useStore } from "../lib/store";
import { useSpeech } from "../lib/useSpeech";
import type { KnowledgeEvent, Persona } from "../lib/types";

const STATE_STYLE: Record<IvClaim["state"], string> = {
  NEU: "bg-mint-50 text-mint-700",
  BESTÄTIGT: "bg-brand-50 text-brand-600",
  AKTUALISIERT: "bg-sky-50 text-sky-500",
  WIDERSPRUCH: "bg-amber-50 text-amber-700",
};
const STATE_EVENT: Record<IvClaim["state"], KnowledgeEvent["kind"]> = { NEU: "NEW", BESTÄTIGT: "SAME", AKTUALISIERT: "UPDATE", WIDERSPRUCH: "CONFLICT" };

/** Server text already has "[IBAN entfernt]" etc.: show those as black chips. */
function ServerRedacted({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+ entfernt\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[.+ entfernt\]$/.test(p) ? (
          <span key={i} className="mx-0.5 inline-flex items-center gap-1 rounded-lg bg-ink px-1.5 py-0.5 align-middle text-[11px] font-bold text-white" title="Vor dem Speichern geschwärzt (§ 30 AO)">
            <ShieldCheck size={11} /> {p.slice(1, -9)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function QBubble({ q, pending }: { q: IvQuestion; pending?: boolean }) {
  const team = q.kind === "open_question" || q.kind === "gap";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <QLogo size={30} />
      <div className={cx("max-w-[85%] rounded-3xl rounded-tl-md px-4 py-3 text-[14px] shadow-soft", team ? "bg-coral-50 ring-1 ring-coral-100" : "bg-white", pending && "ring-2 ring-brand-200")}>
        {team && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-coral-600">
            <AlertTriangle size={11} /> {q.kind === "gap" ? "Wissenslücke – nur du weißt das" : "Frage aus dem Team"}
          </div>
        )}
        {q.kind === "follow_up" && <div className="mb-1 text-[11px] font-bold text-brand-500">Nachfrage</div>}
        {q.text}
      </div>
    </motion.div>
  );
}

function MeBubble({ me, text, live }: { me: Persona; text: string; live?: boolean }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <Avatar p={me} size={30} />
      <div className="max-w-[85%] rounded-3xl rounded-tr-md bg-brand-500 px-4 py-3 text-[14px] leading-relaxed text-white shadow-glow">
        <ServerRedacted text={text} />
        {live && <div className="mt-1.5 text-[11px] font-semibold text-white/70">● gespeichert – nach Schwärzung</div>}
      </div>
    </div>
  );
}

const STEPS = ["Steuerdaten schwärzen", "Aussagen fürs Handbuch erkennen", "Mit vorhandenem Wissen abgleichen", "Nächste Frage wählen"];

export default function LiveInterviewView() {
  const { user, openQuestions, toast, resolveOpenQuestion, addEvents } = useStore();
  const me = personaById(user.personaId)!;
  const [s, setS] = useState<IvSession | null>(null);
  const [busy, setBusy] = useState<string | null>("Q bereitet das Interview vor …");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const speech = useSpeech((t) => setDraft(t));
  const endRef = useRef<HTMLDivElement>(null);

  const myQs = openQuestions.filter((q) => q.routedTo === me.id);
  const pendingQs = myQs.filter((q) => !q.resolved);
  const onlyMe = DATA.facts.filter((f) => f.owner === me.id && !(f.also_known_by ?? []).some((id) => personaById(id)?.status !== "leaving"));

  // resume this person's interview (same browser) or start a new one; colleagues' questions come first
  useEffect(() => {
    let alive = true;
    const key = `q-interview-${me.id}`;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    const fresh = () => interviewApi.start(me.id, pendingQs.map((q) => ({ id: q.id, text: q.text, asked_by: q.askedBy, gap_id: q.gapId })));
    (saved ? interviewApi.get(saved).catch(fresh) : fresh())
      .then((x) => {
        if (!alive) return;
        setS(x);
        try {
          localStorage.setItem(key, x.id);
        } catch {
          /* ignore */
        }
      })
      .catch(() => alive && setError("Das Interview-Backend ist nicht erreichbar."))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [s?.turns.length, busy, s?.current?.text]);

  // progress text while the backend works (it does not stream steps; this mirrors its pipeline)
  useEffect(() => {
    if (!busy || !busy.startsWith("Q strukturiert")) return;
    setStep(0);
    const t = setInterval(() => setStep((x) => Math.min(STEPS.length - 1, x + 1)), 6000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async (label: string, f: () => Promise<IvSession>) => {
    setBusy(label);
    setError(null);
    try {
      const x = await f();
      setS(x);
      return x;
    } catch {
      setError("Das hat nicht geklappt – bitte noch einmal versuchen.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!s || !draft.trim()) return;
    speech.stop();
    const asked = s.current;
    const text = draft;
    setDraft("");
    const res = await run("Q strukturiert deine Antwort …", () => interviewApi.answer(s.id, text));
    if (!res || !("turn" in res)) return;
    const turn = (res as IvSession & { turn: IvSession["turns"][number] }).turn;
    if (turn.redacted.length) toast({ title: "Steuerdaten geschwärzt", body: `${turn.redacted.length}× vor dem Speichern entfernt (§ 30 AO).`, tone: "brand" });
    const conflict = turn.claims.find((c) => c.state === "WIDERSPRUCH");
    if (conflict) toast({ title: "Widerspruch erkannt", body: `${conflict.reason ?? ""} – nach Freigabe zur Klärung an die Führungskraft.`, tone: "amber" });
    if (turn.indexed_now && asked?.ref) {
      resolveOpenQuestion(asked.ref);
      toast({ title: "Wissenslücke geschlossen 🎉", body: "Die Antwort ist sofort in „Frag Q“ durchsuchbar.", tone: "mint" });
    }
    addEvents(
      turn.claims.map((c) => ({
        kind: STATE_EVENT[c.state],
        title: c.text.length > 70 ? c.text.slice(0, 67) + "…" : c.text,
        detail: c.reason ? `${c.state}: ${c.reason}` : `${c.state} – aus dem Wissensinterview`,
        source: `Interview ${me.name} · Frage ${turn.n}`,
      })),
    );
  };

  const answerColleague = (oqId: string) => {
    const oq = myQs.find((q) => q.id === oqId);
    if (!s || !oq) return;
    run("Q wechselt zur Frage aus dem Team …", () =>
      interviewApi.focus(s.id, { kind: "open_question", original: oq.text, ref: oq.id, asked_by: oq.askedBy, gap_id: oq.gapId ?? null }),
    );
  };

  const publish = async () => {
    if (!s) return;
    const res = await run("Q veröffentlicht die Handbuchseite …", () => interviewApi.publish(s.id));
    if (res && "result" in res) {
      const r = (res as IvSession & { result: { published: number; conflicts_flagged: number } }).result;
      toast({
        title: "Handbuchseite veröffentlicht",
        body: `${r.published} Aussagen indexiert – sofort in „Frag Q“ durchsuchbar.${r.conflicts_flagged ? ` ${r.conflicts_flagged} Widerspruch an die Führungskraft.` : ""}`,
        tone: "mint",
      });
    }
  };

  const hb = s?.handbook;
  const claimsTotal = hb?.sections.reduce((n, x) => n + x.claims.length, 0) ?? 0;
  const unpublished = hb?.sections.some((x) => x.claims.some((c) => !c.published)) ?? false;
  const captured = hb ? Math.min(1, 0.1 + (hb.covered / hb.total) * 0.9) : 0.1;

  return (
    <div className="pb-10">
      <PageHeader eyebrow="Wissensinterview" title="Dein Wissen bleibt im Amt" sub="Einfach erzählen – Q fragt nach, schwärzt Steuerdaten und baut daraus dein Übergabe-Handbuch. Kein Schreiben nötig." />
      <div className="space-y-6 px-5 lg:px-8">
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_1fr]">
          <Card className="flex items-center gap-5 p-5">
            <ProgressRing value={captured} size={76} stroke={8} color="#573CFA" track="#EAE6FF">
              <span className="text-[17px] font-extrabold text-brand-600">{Math.round(captured * 100)}%</span>
            </ProgressRing>
            <div>
              <div className="font-bold">Wissen gesichert</div>
              <div className="text-[13px] text-muted">
                {hb ? `${hb.covered}/${hb.total} Handbuch-Bereiche · ${hb.remaining} Fragen offen` : "…"}
                {me.leave_date && (
                  <>
                    {" "}
                    · noch <b className="text-coral-600">{daysUntil(me.leave_date)} Tage</b> bis {fmtDate(me.leave_date)}
                  </>
                )}
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
          <Card className="flex h-[720px] flex-col overflow-hidden xl:sticky xl:top-4">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <QLogo size={36} />
              <div className="flex-1">
                <div className="font-bold">Q interviewt dich</div>
                <div className="text-[12px] text-muted">{me.interview_strategy ?? "Ich frage, du erzählst."}</div>
              </div>
              <Badge tone="mint" icon={<CircleDot size={10} />}>
                Live · KI
              </Badge>
            </div>

            <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto bg-dots p-5">
              {s && s.turns.length === 0 && (
                <div className="mx-auto max-w-md rounded-3xl bg-white p-5 text-center shadow-soft">
                  <div className="text-[15px] font-bold">Schön, dass du dir Zeit nimmst, {me.name.split(" ")[0]}!</div>
                  <p className="mt-1 text-[13px] text-muted">Ich frage, du erzählst – so wie du es einem Neuen beim Kaffee erklären würdest. Steuerfälle schwärze ich automatisch.</p>
                </div>
              )}
              {s?.turns.map((t) => (
                <div key={t.n} className="space-y-3">
                  <QBubble q={t.question} />
                  <MeBubble me={me} text={t.answer} live />
                </div>
              ))}
              {s?.current && !busy && <QBubble q={s.current} pending />}
              {busy && (
                <div className="flex gap-2.5">
                  <QLogo size={30} />
                  <div className="rounded-3xl rounded-tl-md bg-white px-4 py-3 text-[13px] shadow-soft">
                    <div className="font-semibold">{busy}</div>
                    {busy.startsWith("Q strukturiert") && (
                      <div className="mt-1.5 space-y-0.5 text-[12px] text-muted">
                        {STEPS.map((x, i) => (
                          <div key={x} className={cx(i <= step ? "text-brand-600" : "opacity-50")}>
                            {i < step ? "✓" : i === step ? "…" : "·"} {x}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {s && !s.current && !busy && (
                <div className="mx-auto max-w-md rounded-3xl bg-mint-50 p-4 text-center text-[13px] text-mint-700">Alle geplanten Fragen sind beantwortet – danke! Prüfe jetzt die Handbuchseite und gib sie frei.</div>
              )}
              {error && <div className="rounded-2xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
              <div ref={endRef} />
            </div>

            <div className="space-y-2.5 border-t border-line p-4">
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
                  disabled={!!busy || !s?.current}
                  placeholder={speech.listening ? "Ich höre zu …" : "Erzähl oder tippe deine Antwort …"}
                  className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] outline-none"
                />
                <Button onClick={save} disabled={!draft.trim() || !!busy || !s?.current} icon={<Send size={15} />}>
                  Speichern
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {s?.current?.demo_answer && (
                  <Button size="sm" variant="soft" disabled={!!busy} onClick={() => setDraft(s.current?.demo_answer ?? "")}>
                    Demo-Antwort einsprechen
                  </Button>
                )}
                {s?.current && (
                  <Button size="sm" variant="ghost" disabled={!!busy} icon={<SkipForward size={14} />} onClick={() => run("Q sucht die nächste Frage …", () => interviewApi.skip(s.id))}>
                    Überspringen
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="bg-hero p-5 text-white">
                <div className="flex items-center justify-between">
                  <Badge tone="dark" className="!bg-white/15 !text-white !ring-white/20">
                    <BookCheck size={11} /> Handbuchseite – entsteht live
                  </Badge>
                  {hb?.published_at && !unpublished && <Badge tone="mint">Veröffentlicht</Badge>}
                </div>
                <div className="mt-3 text-lg font-extrabold">{me.role_de}</div>
                <div className="text-[13px] text-white/75">
                  Wissen von {me.name} · {hb?.covered ?? 0}/{hb?.total ?? 5} Bereiche
                </div>
              </div>
              <div className="scroll-thin max-h-[440px] space-y-4 overflow-y-auto p-5">
                {hb?.sections.map(({ name, claims }) =>
                  name === "Sonstiges" && !claims.length ? null : (
                    <div key={name}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12px] font-bold uppercase tracking-wide text-muted">{name}</span>
                        {claims.length === 0 && <Badge tone="amber">fehlt noch</Badge>}
                      </div>
                      <AnimatePresence>
                        {claims.map((c) => (
                          <motion.div
                            key={c.id}
                            initial={{ opacity: 0, x: 12, backgroundColor: "#EAE6FF" }}
                            animate={{ opacity: 1, x: 0, backgroundColor: "#ffffff" }}
                            transition={{ duration: 0.6 }}
                            className="mb-1.5 flex gap-2.5 rounded-2xl border border-line p-2.5"
                          >
                            <span className={cx("mt-0.5 h-fit shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide", STATE_STYLE[c.state])}>{c.state}</span>
                            <div className="min-w-0 flex-1 text-[13px] leading-snug">
                              <ServerRedacted text={c.text} />
                              <div className="mt-1 text-[11px] font-semibold text-brand-500">
                                ▶ Frage {c.turn}
                                {c.published && " · veröffentlicht"}
                              </div>
                              {c.matched_citation && c.state !== "NEU" && (
                                <div className="mt-0.5 text-[11px] text-muted" title={c.matched_text ?? ""}>
                                  {c.reason ? `${c.reason} · ` : ""}vgl. {c.matched_citation}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  ),
                )}
              </div>
              <div className="border-t border-line p-4">
                <Button className="w-full" disabled={!claimsTotal || !unpublished || !!busy} onClick={publish} icon={<Check size={16} />}>
                  {claimsTotal && !unpublished ? "Veröffentlicht" : "Prüfen & freigeben"}
                </Button>
                {!!hb?.conflicts && <div className="mt-2 text-center text-[11px] text-amber-700">{hb.conflicts} Widerspruch – geht nach der Freigabe an die Führungskraft</div>}
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
                    const active = s?.current?.ref === q.id;
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
                            <Button size="sm" variant={active ? "soft" : "primary"} disabled={active || !!busy || !s} onClick={() => answerColleague(q.id)}>
                              {active ? "Wird beantwortet …" : "Jetzt beantworten"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
