import { useEffect, useRef } from "react";

/** Soft colour glow that follows the cursor across the parent (parent must be `relative`).
 *  The hue shifts with the cursor's position, so the empty space lights up in different colours. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hue = Math.round((x / r.width) * 240 + (y / r.height) * 120) % 360;
      el.style.opacity = "1";
      el.style.background = `radial-gradient(260px circle at ${x}px ${y}px, hsl(${hue} 95% 70% / 0.38), hsl(${(hue + 60) % 360} 95% 75% / 0.16) 45%, transparent 70%)`;
    };
    const leave = () => (el.style.opacity = "0");
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300" />;
}
