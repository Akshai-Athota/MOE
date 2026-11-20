import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { avatarColor, initials } from "../lib/data";
import type { Persona } from "../lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function QLogo({ size = 40, glow = false }: { size?: number; glow?: boolean }) {
  const gid = "qg" + useId().replace(/:/g, "");
  return (
    <div className={cx("relative grid place-items-center", glow && "drop-shadow-[0_8px_20px_rgba(87,60,250,0.45)]")} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7A63FF" />
            <stop offset="1" stopColor="#4A2FE6" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="20" fill={`url(#${gid})`} />
        <circle cx="30" cy="30" r="13.5" fill="none" stroke="#fff" strokeWidth="7" />
        <circle cx="25.5" cy="28" r="2" fill="#fff" />
        <circle cx="34.5" cy="28" r="2" fill="#fff" />
        <path d="M26 33.5c2.4 2 5.6 2 8 0" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M39 39l8.5 8.5" stroke="#FFB4A0" strokeWidth="7" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-3xl border border-line bg-white shadow-soft", className)} {...rest}>
      {children}
    </div>
  );
}

type Tone = "brand" | "mint" | "coral" | "amber" | "rose" | "sky" | "gray" | "dark";
const TONES: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  mint: "bg-mint-50 text-mint-700 ring-mint-100",
  coral: "bg-coral-50 text-coral-600 ring-coral-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
  sky: "bg-sky-50 text-sky-500 ring-sky-50",
  gray: "bg-canvas text-muted ring-line",
  dark: "bg-ink text-white ring-ink",
};
export function Badge({ children, tone = "brand", icon, className }: { children: ReactNode; tone?: Tone; icon?: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Avatar({ p, size = 40, ring = false }: { p?: Persona; size?: number; ring?: boolean }) {
  if (!p) return null;
  const c = avatarColor(p.id);
  return (
    <div
      className={cx("grid shrink-0 place-items-center rounded-full font-bold text-white", ring && "ring-4 ring-white")}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${c}, ${c}cc)` }}
      title={p.name}
    >
      {initials(p.name)}
    </div>
  );
}

type BtnVariant = "primary" | "soft" | "ghost" | "white" | "coral" | "outline";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-glow",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
  white: "bg-white text-brand-700 hover:bg-brand-50 shadow-soft",
  coral: "bg-coral-500 text-white hover:bg-coral-600 shadow-[0_10px_30px_-8px_rgba(255,122,89,0.6)]",
  outline: "border border-line bg-white text-ink hover:border-brand-200 hover:bg-brand-50",
};
export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  icon,
  ...rest
}: { children?: ReactNode; variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const s = size === "sm" ? "h-9 px-3.5 text-[13px]" : size === "lg" ? "h-13 px-6 text-[15px]" : "h-11 px-5 text-sm";
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        s,
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function ProgressRing({ value, size = 88, stroke = 9, color = "#fff", track = "rgba(255,255,255,0.22)", children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, value)) }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Waveform({ active, bars = 28, color = "#573CFA", className }: { active: boolean; bars?: number; color?: string; className?: string }) {
  return (
    <div className={cx("flex h-10 items-center gap-[3px]", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cx("w-[3px] rounded-full", active && "wave-bar")}
          style={{
            height: `${30 + ((i * 37) % 70)}%`,
            background: color,
            opacity: active ? 0.9 : 0.25,
            animationDelay: `${(i % 7) * 0.09}s`,
            transform: active ? undefined : "scaleY(0.4)",
          }}
        />
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className={cx("fixed inset-y-3 right-3 z-50 flex w-[calc(100%-24px)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="font-bold">{title}</h3>
              <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-canvas" aria-label="Schließen">
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto p-6">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Stat({ label, value, icon, tone = "brand", hint }: { label: string; value: ReactNode; icon: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1", TONES[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold tracking-tight">{value}</div>
        <div className="truncate text-[13px] text-muted">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted/80">{hint}</div>}
      </div>
    </Card>
  );
}

export function Empty({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-brand-200 bg-brand-50/40 px-6 py-10 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft">{icon}</div>
      <div className="font-semibold">{title}</div>
      {sub && <div className="mt-1 max-w-xs text-[13px] text-muted">{sub}</div>}
    </div>
  );
}
