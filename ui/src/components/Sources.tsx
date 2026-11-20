import { FileText, Image, Mail, Mic, MonitorPlay, NotebookPen, Pause, Play, PartyPopper, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { DATA, fmtDate, personaById, ruleById } from "../lib/data";
import type { Citation, Fact } from "../lib/types";
import { Avatar, Badge, Drawer, Waveform, cx } from "./ui";

export const KIND_ICON: Record<string, typeof FileText> = {
  interview: Mic,
  video: MonitorPlay,
  doc: FileText,
  email: Mail,
  minutes: NotebookPen,
  intranet: Globe,
  image: Image,
  quiz: PartyPopper,
};

export function CitationChip({ c, onClick, n }: { c: Citation; onClick: () => void; n?: number }) {
  const Icon = KIND_ICON[c.kind] ?? FileText;
  return (
    <button
      onClick={onClick}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-xl border border-brand-100 bg-white px-2.5 py-1.5 text-left text-[12px] font-medium text-brand-700 transition hover:border-brand-300 hover:bg-brand-50"
    >
      {n !== undefined && <span className="grid h-4 w-4 shrink-0 place-items-center rounded-md bg-brand-500 text-[10px] font-bold text-white">{n}</span>}
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{c.label}</span>
      {c.anchor && (
        <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 group-hover:bg-white">
          {(c.kind === "interview" || c.kind === "video") && <Play size={9} fill="currentColor" />}
          {c.anchor}
        </span>
      )}
    </button>
  );
}

function Player({ anchor }: { anchor: string }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), 6000);
    return () => clearTimeout(t);
  }, [playing]);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-brand-500 p-3 text-white">
      <button onClick={() => setPlaying((p) => !p)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-600" aria-label="Abspielen">
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      <Waveform active={playing} color="#fff" bars={34} className="flex-1 overflow-hidden" />
      <span className="rounded-lg bg-white/15 px-2 py-1 text-xs font-bold tabular-nums">#{anchor}</span>
    </div>
  );
}

export function SourceDrawer({ fact, citation, onClose }: { fact?: Fact; citation?: Citation; onClose: () => void }) {
  const owner = personaById(fact?.owner);
  const rule = ruleById(fact?.rule);
  const prev = fact?.supersedes ? DATA.facts.find((f) => f.id === fact.supersedes) : undefined;
  const others = (fact?.also_known_by ?? []).map(personaById).filter(Boolean);
  return (
    <Drawer open={!!fact} onClose={onClose} title="Quelle">
      {fact && citation && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge tone="gray">{fact.id}</Badge>
              {fact.status === "superseded" && <Badge tone="amber">Veraltet</Badge>}
              {fact.status === "conflict" && <Badge tone="rose">Widerspruch</Badge>}
              {fact.learned && <Badge tone="mint">Neu gelernt</Badge>}
              <Badge tone={fact.access === "restricted" ? "rose" : fact.access === "public" ? "sky" : "brand"}>
                {fact.access === "restricted" ? "Vertraulich" : fact.access === "public" ? "Öffentlich" : "Intern"}
              </Badge>
            </div>
            <h4 className="text-lg font-bold leading-snug">{fact.topic}</h4>
          </div>

          <div className="rounded-2xl border border-line bg-canvas p-4 text-[14px] leading-relaxed">„{fact.de}“</div>

          {(citation.kind === "interview" || citation.kind === "video" || citation.kind === "quiz") && citation.anchor && <Player anchor={citation.anchor} />}

          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-2xl bg-canvas p-3">
              <div className="text-muted">Gültig ab</div>
              <div className="font-semibold">{fmtDate(fact.valid_from)}</div>
            </div>
            <div className="rounded-2xl bg-canvas p-3">
              <div className="text-muted">{fact.valid_to ? "Gültig bis" : "Quelle"}</div>
              <div className="truncate font-semibold">{fact.valid_to ? fmtDate(fact.valid_to) : citation.label}</div>
            </div>
          </div>

          {owner && (
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Wissensträger:in</div>
              <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
                <Avatar p={owner} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{owner.name}</div>
                  <div className="truncate text-[12px] text-muted">
                    {owner.role_de} · Raum {owner.room} · {owner.phone_ext}
                  </div>
                </div>
                {owner.status === "leaving" && <Badge tone="coral">geht {fmtDate(owner.leave_date)}</Badge>}
              </div>
              {others.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                  Bestätigt von
                  <div className="flex -space-x-2">
                    {others.map((p) => (
                      <Avatar key={p!.id} p={p} size={24} ring />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {rule && (
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Dokument {rule.id}</div>
              <div className="rounded-2xl border border-line p-4">
                <div className="mb-2 font-semibold">{rule.title_de}</div>
                <ol className="space-y-1.5 text-[13px] text-ink/80">
                  {rule.clauses.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-bold text-brand-500">§{i + 1}</span>
                      {c}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {prev && (
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Verlauf</div>
              <div className="relative space-y-3 pl-5 before:absolute before:left-[7px] before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-brand-100">
                <TimelineDot active label={`seit ${fmtDate(fact.valid_from)}`} text={fact.de} />
                <TimelineDot label={`${fmtDate(prev.valid_from)} – ${fmtDate(prev.valid_to)}`} text={prev.de} />
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function TimelineDot({ active, label, text }: { active?: boolean; label: string; text: string }) {
  return (
    <div className="relative">
      <span className={cx("absolute -left-5 top-1 h-3.5 w-3.5 rounded-full border-[3px] border-white", active ? "bg-brand-500" : "bg-line")} />
      <div className={cx("text-[12px] font-semibold", active ? "text-brand-600" : "text-muted")}>{label}</div>
      <div className={cx("text-[13px]", !active && "text-muted line-through decoration-muted/40")}>{text}</div>
    </div>
  );
}
