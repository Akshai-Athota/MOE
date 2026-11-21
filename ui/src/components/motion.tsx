import { motion, useAnimationControls } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { cx } from "./ui";

export type Mood = "idle" | "thinking" | "listening" | "happy";

/**
 * Finn's face: a rounded tile with two eyes. Minimal and alive.
 * idle = blinks now and then · thinking = eyes glance around · listening = soft pulse · happy = smiling eyes
 */
export function FinnAvatar({ size = 28, mood = "idle", className }: { size?: number; mood?: Mood; className?: string }) {
  const eyes = useAnimationControls();

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const blink = () => {
      if (!alive) return;
      eyes.start({ scaleY: [1, 0.1, 1], transition: { duration: 0.22, times: [0, 0.5, 1] } });
      t = setTimeout(blink, 2600 + Math.random() * 3200);
    };
    if (mood === "idle" || mood === "listening") t = setTimeout(blink, 900 + Math.random() * 1500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mood, eyes]);

  const look =
    mood === "thinking"
      ? { x: [0, 2.2, 2.2, -2.2, -2.2, 0], y: [0, -1.5, -1.5, -1.5, -1.5, 0], transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const } }
      : { x: 0, y: 0 };

  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      {mood === "listening" && (
        <motion.span
          className="absolute inset-0 rounded-[30%] bg-accent"
          animate={{ scale: [1, 1.35], opacity: [0.35, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        className="relative"
        animate={mood === "thinking" ? { rotate: [0, -3, 3, 0] } : { rotate: 0 }}
        transition={mood === "thinking" ? { duration: 3, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        <rect width="32" height="32" rx="10" className="fill-accent" />
        {mood === "happy" ? (
          <g stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none">
            <path d="M9.5 16.5 Q12 13.5 14.5 16.5" />
            <path d="M17.5 16.5 Q20 13.5 22.5 16.5" />
          </g>
        ) : (
          <motion.g animate={look}>
            <motion.g animate={eyes} style={{ originY: "15px" }}>
              <rect x="10" y="12" width="3.6" height="6.4" rx="1.8" fill="white" />
              <rect x="18.4" y="12" width="3.6" height="6.4" rx="1.8" fill="white" />
            </motion.g>
          </motion.g>
        )}
      </motion.svg>
    </span>
  );
}

/** Scroll-in: fade up with a light blur, once, like the calm reveals on GitHub's sign-in page. */
export function Reveal({ children, delay = 0, className, as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" }) {
  const C = motion[as];
  return (
    <C
      className={className}
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </C>
  );
}
