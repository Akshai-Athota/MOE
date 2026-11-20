import { AnimatePresence, motion } from "framer-motion";
import { BookMarked, Layers, MessageSquare, RotateCcw, Sunrise, type LucideIcon } from "lucide-react";
import { FinnAvatar } from "./components/motion";
import { Avatar, cx } from "./components/ui";
import { DEMO_USERS, personaById } from "./lib/data";
import { VIEWS_BY_ROLE, useStore, type View } from "./lib/store";
import AskView from "./views/AskView";
import InterviewView from "./views/InterviewView";
import LibraryView from "./views/LibraryView";
import StartView from "./views/StartView";

const NAV: Record<View, { label: string; icon: LucideIcon; comp: () => React.JSX.Element }> = {
  start: { label: "Mein Start", icon: Sunrise, comp: StartView },
  interview: { label: "Wissensinterview", icon: Layers, comp: InterviewView },
  ask: { label: "Frag Finn", icon: MessageSquare, comp: AskView },
  library: { label: "Wissensbibliothek", icon: BookMarked, comp: LibraryView },
};

function UserSwitch() {
  const { userIdx, setUserIdx } = useStore();
  return (
    <div className="space-y-0.5">
      {DEMO_USERS.map((u, i) => {
        const p = personaById(u.personaId)!;
        const on = i === userIdx;
        return (
          <button
            key={u.personaId}
            onClick={() => setUserIdx(i)}
            className={cx("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors", on ? "bg-subtle" : "hover:bg-subtle/60")}
          >
            <Avatar p={p} size={26} />
            <span className="min-w-0 flex-1">
              <span className={cx("block truncate text-[13px]", on ? "font-medium text-ink" : "text-muted")}>{p.name}</span>
              <span className="block truncate text-[11.5px] text-faint">{u.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const { user, view, setView, toasts, reset, openQuestions, backend } = useStore();
  const views = VIEWS_BY_ROLE[user.role];
  const active = views.includes(view) ? view : views[0];
  const Comp = NAV[active].comp;
  const waiting = openQuestions.filter((q) => !q.resolved && q.routedTo === user.personaId).length;

  return (
    <div className="flex h-full">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <FinnAvatar size={28} />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold">Finn</div>
            <div className="text-[11.5px] text-muted">Dein Finanzamt-Assistent</div>
          </div>
        </div>
        <nav className="mt-3 space-y-0.5 px-3">
          {views.map((v) => {
            const { label, icon: Icon } = NAV[v];
            const on = v === active;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cx("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors", on ? "bg-subtle font-medium text-ink" : "text-muted hover:bg-subtle/60 hover:text-ink")}
              >
                <Icon size={16} strokeWidth={on ? 2.2 : 1.8} />
                {label}
                {v === "interview" && waiting > 0 && <span className="ml-auto rounded-full bg-ink px-1.5 text-[11px] font-medium leading-5 text-white">{waiting}</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 border-t border-line p-3">
          <UserSwitch />
          <div className="flex items-center justify-between px-2 text-[11.5px] text-faint">
            <span className="flex items-center gap-1.5">
              <span className={cx("h-1.5 w-1.5 rounded-full", backend === "live" ? "bg-accent" : backend === "checking" ? "bg-line-strong" : "bg-gold")} />
              {backend === "live" ? "Verbunden" : backend === "checking" ? "Verbinde …" : "Demo-Modus"}
            </span>
            <button onClick={reset} className="flex items-center gap-1 hover:text-ink" title="Demo zurücksetzen">
              <RotateCcw size={11} /> Zurücksetzen
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* mobile header */}
        <div className="flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <FinnAvatar size={26} />
            <span className="font-semibold">Finn</span>
          </div>
          <MobileUser />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-0">
          <AnimatePresence mode="wait">
            <motion.div key={active + user.personaId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="min-h-full">
              <Comp />
            </motion.div>
          </AnimatePresence>
        </div>
        {/* mobile tabs */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface lg:hidden">
          {views.map((v) => {
            const { label, icon: Icon } = NAV[v];
            return (
              <button key={v} onClick={() => setView(v)} className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", v === active ? "text-ink" : "text-faint")}>
                <Icon size={18} />
                {label.split(" ").pop()}
              </button>
            );
          })}
        </nav>
      </main>

      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 lg:bottom-6">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[10px] bg-ink px-4 py-2.5 text-[13px] text-white shadow-pop">
              <span className="font-medium">{t.title}</span>
              {t.body && <span className="text-white/70"> · {t.body}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MobileUser() {
  const { userIdx, setUserIdx } = useStore();
  const next = (userIdx + 1) % DEMO_USERS.length;
  const me = personaById(DEMO_USERS[userIdx].personaId)!;
  return (
    <button onClick={() => setUserIdx(next)} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-[12.5px]">
      <Avatar p={me} size={22} />
      {me.name.split(" ")[0]}
    </button>
  );
}
