import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Paperclip, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Reveal } from "../components/motion";
import { Avatar, PageHeader, Spinner, cx } from "../components/ui";
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
  const [sent, setSent] = useState(0); // bumps on every share -> composer animation
  const [fresh, setFresh] = useState<string | null>(null);
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

  /** Never blocks: the post appears at once, the server is updated in the background. */
  const share = () => {
    if (!text.trim() && !file) return;
    const t = text;
    setText("");
    setFile(undefined);
    setFilter("all");
    setQ("");
    setSent((n) => n + 1);
    setFresh(t.trim().slice(0, 40));
    addPost(t, topic, file).catch(() => toast({ title: "Konnte nicht geteilt werden" }));
    setTimeout(() => setFresh(null), 1600);
  };

  return (
    <div className="pb-16">
      <PageHeader title="Wissensbibliothek" sub="Was alle wissen sollten – vom defekten Drucker bis zum neuen Ablauf. Finn kennt jeden Eintrag." />

      <Reveal className="max-w-[760px] px-6 pt-8 lg:px-10">
        <motion.div
          key={sent}
          initial={sent ? { scale: 0.985, boxShadow: "0 0 0 4px rgb(15 94 84 / 0.18)" } : false}
          animate={{ scale: 1, boxShadow: "0 0 0 0px rgb(15 94 84 / 0)" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-[12px] border border-line bg-surface shadow-xs focus-within:border-line-strong"
        >
          <AnimatePresence>
            {fresh !== null && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute right-4 top-3.5 flex items-center gap-1.5 text-[12.5px] font-medium text-accent"
              >
                <Check size={13} strokeWidth={2.6} /> Geteilt
              </motion.span>
            )}
          </AnimatePresence>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                share();
              }
            }}
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
            <span className="ml-auto hidden text-[11.5px] text-faint sm:block">Enter zum Teilen</span>
            <button
              onClick={share}
              disabled={!text.trim() && !file}
              className="grid h-8 w-8 place-items-center rounded-[8px] bg-ink text-white transition-opacity disabled:opacity-25 sm:ml-0"
              aria-label="Teilen"
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </motion.div>

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
            <AnimatePresence initial={false}>
            {posts.map((p) => {
              const author = personaById(p.user_id) ?? DATA.personas[0];
              return (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: -14, filter: "blur(6px)", backgroundColor: "rgb(229 239 237 / 1)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)", backgroundColor: "rgb(229 239 237 / 0)" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], backgroundColor: { duration: 1.6 } }}
                  className="group -mx-3 flex gap-3 rounded-[10px] px-3 py-5"
                >
                  <Avatar p={author} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                      <span className="font-medium text-ink">{p.author}</span>
                      <span>{TOPICS[p.category] ?? "Alltag"}</span>
                      <span className="text-faint">{when(p.created)}</span>
                      {p.sending && (
                        <span className="flex items-center gap-1.5 text-faint">
                          <Spinner className="!h-3 !w-3" /> wird geteilt
                        </span>
                      )}
                      {p.resolved && (
                        <span className="flex items-center gap-1 text-accent">
                          <Check size={12} /> Erledigt
                        </span>
                      )}
                    </div>
                    <p className={cx("mt-1 whitespace-pre-line text-[14px] leading-relaxed", p.resolved ? "text-faint line-through decoration-faint/50" : "text-ink-2")}>{p.text}</p>
                  </div>
                  {!p.resolved && !p.sending && (
                    <button onClick={() => resolvePost(p.id)} className="h-8 shrink-0 self-start rounded-[8px] px-2.5 text-[12.5px] text-muted opacity-0 transition-opacity hover:bg-subtle hover:text-ink group-hover:opacity-100 max-lg:opacity-100">
                      Erledigt
                    </button>
                  )}
                </motion.li>
              );
            })}
            </AnimatePresence>
          </ul>
        )}
      </Reveal>
    </div>
  );
}
