import { BookMarked, FileText, Globe, Image, Mail, Mic, MonitorPlay, NotebookPen } from "lucide-react";
import { fmtDate, personaById, ruleById } from "../lib/data";
import type { Citation, Fact } from "../lib/types";
import { Avatar, Sheet } from "./ui";

const KIND_ICON: Record<string, typeof FileText> = {
  interview: Mic,
  video: MonitorPlay,
  doc: FileText,
  email: Mail,
  minutes: NotebookPen,
  intranet: Globe,
  image: Image,
  library: BookMarked,
};

export function SourceLink({ c, n, onClick }: { c: Citation; n: number; onClick: () => void }) {
  const Icon = KIND_ICON[c.kind] ?? FileText;
  return (
    <button onClick={onClick} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink">
      <span className="font-medium text-ink">{n}</span>
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{c.label}</span>
      {c.anchor && <span className="shrink-0 tabular-nums text-faint">{c.anchor}</span>}
    </button>
  );
}

export function SourceSheet({ fact, citation, onClose }: { fact?: Fact; citation?: Citation; onClose: () => void }) {
  const owner = personaById(fact?.owner);
  const rule = ruleById(fact?.rule);
  return (
    <Sheet open={!!fact} onClose={onClose} title="Quelle">
      {fact && citation && (
        <div className="space-y-6">
          <div>
            <div className="text-[12px] text-muted">{citation.label}{citation.anchor ? ` · ${citation.anchor}` : ""}</div>
            <h3 className="mt-1 text-[15px] font-semibold leading-snug">{fact.topic}</h3>
          </div>
          <blockquote className="border-l-2 border-accent pl-4 text-[14px] leading-relaxed text-ink-2">{fact.de}</blockquote>
          <dl className="grid grid-cols-2 gap-y-3 text-[13px]">
            <dt className="text-muted">Gültig ab</dt>
            <dd>{fmtDate(fact.valid_from) || "–"}</dd>
            {fact.valid_to && (
              <>
                <dt className="text-muted">Gültig bis</dt>
                <dd>{fmtDate(fact.valid_to)}</dd>
              </>
            )}
            <dt className="text-muted">Zugriff</dt>
            <dd>{fact.access === "restricted" ? "Vertraulich" : fact.access === "public" ? "Öffentlich" : "Intern"}</dd>
          </dl>
          {owner && (
            <div className="flex items-center gap-3 border-t border-line pt-5">
              <Avatar p={owner} size={32} />
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium">{owner.name}</div>
                <div className="truncate text-[12px] text-muted">
                  {owner.role_de.split(",")[0]} · Raum {owner.room} · {owner.phone_ext}
                </div>
              </div>
            </div>
          )}
          {rule && (
            <div className="border-t border-line pt-5">
              <div className="mb-2 text-[13px] font-medium">
                {rule.id} · {rule.title_de}
              </div>
              <ol className="space-y-2 text-[13px] text-ink-2">
                {rule.clauses.map((c, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="tabular-nums text-faint">{i + 1}.</span>
                    {c}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
