import { Check, Paperclip, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Avatar, Button, PageHeader, Spinner, cx } from "../components/ui";
import { DATA, TODAY, personaById } from "../lib/data";
import { useStore } from "../lib/store";

const TOPICS: Record<string, string> = {
  general: "Alltag",
  it: "IT & Technik",
  process: "Abläufe",
  org: "Organisation",
  finance: "Haushalt & Beschaffung",
  communication: "Kommunikation",
};

function when(iso: string) {
  const d = new Date(iso);
  const day = iso.slice(0, 10);
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (day === TODAY) return `Heute, ${time}`;
  const diff = Math.round((Date.parse(TODAY) - Date.parse(day)) / 86400000);
  if (diff === 1) return `Gestern, ${time}`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function LibraryView() {
  const { libraryPosts, addPost, resolvePost, toast } = useStore();
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("general");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const posts = useMemo(
    () =>
      libraryPosts.filter(
        (p) => (filter === "all" || p.category === filter) && (!q.trim() || `${p.text} ${p.author}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [libraryPosts, filter, q],
  );
  const used = useMemo(() => Object.keys(TOPICS).filter((t) => libraryPosts.some((p) => p.category === t)), [libraryPosts]);

  const share = async () => {
    if (!text.trim() && !file) return;
    setBusy(true);
    try {
      await addPost(text, topic, file);
      setText("");
      setFile(undefined);
      toast({ title: "Geteilt", body: "Finn kennt den Eintrag ab sofort." });
    } catch {
      toast({ title: "Konnte nicht geteilt werden" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-16">
      <PageHeader title="Wissensbibliothek" sub="Was alle wissen sollten – vom defekten Drucker bis zum neuen Ablauf. Finn kennt jeden Eintrag." />

      <div className="max-w-[760px] px-6 pt-8 lg:px-10">
        <div className="rounded-[12px] border border-line bg-surface shadow-xs focus-within:border-line-strong">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Was sollten deine Kolleg:innen wissen? Zum Beispiel: Der Drucker im 2. OG ist defekt."
            className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-relaxed outline-none placeholder:text-faint"
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink-2 outline-none hover:border-line-strong">
              {Object.entries(TOPICS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {file ? (
              <span className="flex h-8 items-center gap-1.5 rounded-[8px] bg-subtle px-2.5 text-[12.5px] text-ink-2">
                <Paperclip size={12} />
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button onClick={() => setFile(undefined)} aria-label="Anhang entfernen" className="text-muted hover:text-ink">
                  <X size={12} />
                </button>
              </span>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-muted hover:bg-subtle hover:text-ink">
                <Paperclip size={14} /> Datei
              </button>
            )}
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.md,.txt,image/*,audio/*" onChange={(e) => setFile(e.target.files?.[0])} />
            <Button className="ml-auto" size="sm" onClick={share} disabled={busy || (!text.trim() && !file)}>
              {busy ? <Spinner /> : "Teilen"}
            </Button>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line">
          {["all", ...used].map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={cx("-mb-px border-b-2 pb-2.5 text-[13px] transition-colors", filter === t ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
              {t === "all" ? "Alle" : TOPICS[t]}
            </button>
          ))}
          <label className="mb-2 ml-auto flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-muted focus-within:border-line-strong">
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen" className="w-36 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" />
          </label>
        </div>

        {posts.length === 0 ? (
          <p className="py-12 text-center text-[13.5px] text-muted">{libraryPosts.length ? "Keine Treffer." : "Noch keine Einträge. Teile den ersten!"}</p>
        ) : (
          <ul className="divide-y divide-line">
            {posts.map((p) => {
              const author = personaById(p.user_id) ?? DATA.personas[0];
              return (
                <li key={p.id} className="group flex gap-3 py-5">
                  <Avatar p={author} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                      <span className="font-medium text-ink">{p.author}</span>
                      <span>{TOPICS[p.category] ?? "Alltag"}</span>
                      <span className="text-faint">{when(p.created)}</span>
                      {p.resolved && (
                        <span className="flex items-center gap-1 text-accent">
                          <Check size={12} /> Erledigt
                        </span>
                      )}
                    </div>
                    <p className={cx("mt-1 whitespace-pre-line text-[14px] leading-relaxed", p.resolved ? "text-faint line-through decoration-faint/50" : "text-ink-2")}>{p.text}</p>
                  </div>
                  {!p.resolved && (
                    <button onClick={() => resolvePost(p.id)} className="h-8 shrink-0 self-start rounded-[8px] px-2.5 text-[12.5px] text-muted opacity-0 transition-opacity hover:bg-subtle hover:text-ink group-hover:opacity-100 max-lg:opacity-100">
                      Erledigt
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
