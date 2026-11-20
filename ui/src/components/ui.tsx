import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { avatarColor, initials } from "../lib/data";
import type { Persona } from "../lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Finn's mark: a simple monogram. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[8px] bg-accent font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      F
    </span>
  );
}

export function Avatar({ p, size = 28 }: { p?: Persona; size?: number }) {
  if (!p) return null;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-medium text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: avatarColor(p.id) }} title={p.name}>
      {initials(p.name)}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle",
  ghost: "text-muted hover:bg-subtle hover:text-ink",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  icon,
  ...rest
}: { children?: ReactNode; variant?: Variant; size?: "sm" | "md"; icon?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-[13.5px]",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-ink/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-line bg-surface"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              <h3 className="text-[14px] font-semibold">{title}</h3>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-subtle" aria-label="Schließen">
                <X size={16} />
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-6 pb-5 pt-7 lg:px-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        {sub && <p className="mt-1 text-[13.5px] text-muted">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-faint">{children}</h2>
      {right}
    </div>
  );
}
