import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, ChevronsUpDown, LayoutGrid, MessageCircle, Mic, PartyPopper, RotateCcw, Rocket, ShieldCheck, Check } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Avatar, QLogo, cx } from "./components/ui";
import { DATA, DEMO_USERS, ROLE_LABEL, personaById } from "./lib/data";
import { VIEWS_BY_ROLE, useStore, type View } from "./lib/store";
import AskView from "./views/AskView";
import CelebrationView from "./views/CelebrationView";
import CoverageView from "./views/CoverageView";
import InterviewView from "./views/InterviewView";
import MemoryView from "./views/MemoryView";
import OnboardingView from "./views/OnboardingView";

const NAV: Record<View, { label: string; icon: LucideIcon; comp: ComponentType }> = {
  onboarding: { label: "Mein Start", icon: Rocket, comp: OnboardingView },
  ask: { label: "Frag Q", icon: MessageCircle, comp: AskView },
  interview: { label: "Wissensinterview", icon: Mic, comp: InterviewView },
  celebration: { label: "Abschied", icon: PartyPopper, comp: CelebrationView },
  memory: { label: "Wissen & Verlauf", icon: BrainCircuit, comp: MemoryView },
  coverage: { label: "Wissenslandkarte", icon: LayoutGrid, comp: CoverageView },
};

function RoleSwitcher({ compact }: { compact?: boolean }) {
  const { userIdx, setUserIdx } = useStore();
  const [open, setOpen] = useState(false);
  const me = personaById(DEMO_USERS[userIdx].personaId)!;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx("flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-2.5 text-left transition hover:border-brand-200", compact && "p-1.5 pr-2.5")}
      >
        <Avatar p={me} size={compact ? 32 : 38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold">{me.name}</div>
          {!compact && <div className="truncate text-[11px] text-muted">{ROLE_LABEL[DEMO_USERS[userIdx].role]}</div>}
        </div>
        <ChevronsUpDown size={15} className="text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className={cx("absolute z-40 w-72 rounded-3xl border border-line bg-white p-2 shadow-2xl", compact ? "right-0 top-14" : "bottom-16 left-0")}
            >
              <div className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Ansicht wechseln (Demo)</div>
              {DEMO_USERS.map((u, i) => {
                const p = personaById(u.personaId)!;
                return (
                  <button
                    key={u.personaId}
                    onClick={() => {
                      setUserIdx(i);
                      setOpen(false);
                    }}
                    className={cx("flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-canvas", i === userIdx && "bg-brand-50")}
                  >
                    <Avatar p={p} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{p.name}</div>
                      <div className="truncate text-[11px] text-muted">
                        {u.label} · {p.role_de.split(",")[0]}
                      </div>
                    </div>
                    {i === userIdx && <Check size={16} className="text-brand-500" />}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const { user, view, setView, toasts, reset, openQuestions, resolved } = useStore();
  const views = VIEWS_BY_ROLE[user.role];
  const active = views.includes(view) ? view : views[0];
  const Comp = NAV[active].comp;
  const counts: Partial<Record<View, number>> = {
    interview: openQuestions.filter((q) => !q.resolved && q.routedTo === user.personaId).length,
    memory: DATA.plants.conflicts.filter((c) => !resolved[c.question]).length,
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-[272px] shrink-0 flex-col gap-6 p-4 lg:flex">
        <div className="flex items-center gap-3 px-2 pt-2">
          <QLogo size={44} glow />
          <div>
            <div className="text-xl font-extrabold leading-none tracking-tight">Q</div>
            <div className="mt-1 text-[11px] font-medium text-muted">Das Gedächtnis des Finanzamts</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {views.map((v) => {
            const { label, icon: Icon } = NAV[v];
            const on = v === active;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cx(
                  "relative flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[14px] font-semibold transition",
                  on ? "bg-brand-500 text-white shadow-glow" : "text-muted hover:bg-white hover:text-ink",
                )}
              >
                <Icon size={19} />
                {label}
                {!!counts[v] && (
                  <span className={cx("ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold", on ? "bg-white text-brand-600" : "bg-coral-500 text-white")}>
                    {counts[v]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-3xl bg-hero p-4 text-white">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              <ShieldCheck size={16} /> Geschützt
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/80">
              Q zeigt nur, was deine Rolle sehen darf, und schwärzt Steuerdaten automatisch (§ 30 AO).
            </p>
          </div>
          <RoleSwitcher />
          <button onClick={reset} className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-[11px] font-medium text-muted hover:text-ink">
            <RotateCcw size={12} /> Demo zurücksetzen
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col lg:py-4 lg:pr-4">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 lg:hidden">
          <div className="flex items-center gap-2.5">
            <QLogo size={36} />
            <div className="text-lg font-extrabold">Q</div>
          </div>
          <RoleSwitcher compact />
        </div>
        <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto rounded-none bg-white/60 pb-24 lg:rounded-[32px] lg:border lg:border-line lg:bg-white/70 lg:pb-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={active + user.personaId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="h-full"
            >
              <Comp />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-3xl border border-line bg-white/95 p-1.5 shadow-2xl backdrop-blur lg:hidden">
        {views.map((v) => {
          const { label, icon: Icon } = NAV[v];
          const on = v === active;
          return (
            <button key={v} onClick={() => setView(v)} className={cx("flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold", on ? "bg-brand-500 text-white" : "text-muted")}>
              <Icon size={18} />
              {label.split(" ")[0]}
            </button>
          );
        })}
      </nav>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-24 right-4 z-[60] flex w-[340px] max-w-[calc(100%-32px)] flex-col gap-2 lg:bottom-6 lg:right-6">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30 }}
              className="pointer-events-auto flex gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-2xl"
            >
              <div
                className={cx(
                  "mt-0.5 h-8 w-1.5 shrink-0 rounded-full",
                  t.tone === "mint" ? "bg-mint-500" : t.tone === "coral" ? "bg-coral-500" : t.tone === "amber" ? "bg-amber-500" : "bg-brand-500",
                )}
              />
              <div>
                <div className="text-[13px] font-bold">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[12px] text-muted">{t.body}</div>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
