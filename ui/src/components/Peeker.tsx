import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/* One shared mouse listener for every peeker on the page. */
const mouse = { x: -1, y: -1 };
const subs = new Set<() => void>();
let bound = false;
function onMouse(fn: () => void) {
  if (!bound && typeof window !== "undefined") {
    bound = true;
    window.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      subs.forEach((s) => s());
    }, { passive: true });
  }
  subs.add(fn);
  return () => void subs.delete(fn);
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Little cat-eared buddy that peeks over the top edge of a card at random and watches the mouse.
 *  Render inside a `relative` wrapper, before the card (the card needs a higher z-index). */
export function Peeker({ active = true }: { active?: boolean }) {
  const reduce = useReducedMotion();
  const [peek, setPeek] = useState<{ pos: number; id: number } | null>(null);

  useEffect(() => {
    if (!active || reduce) return;
    let t: number;
    const schedule = (first = false) => {
      t = window.setTimeout(() => {
        setPeek({ pos: rand(12, 62), id: Date.now() });
        t = window.setTimeout(() => {
          setPeek(null);
          schedule();
        }, rand(2500, 4200));
      }, first ? rand(600, 10000) : rand(7000, 18000));
    };
    schedule(true);
    return () => window.clearTimeout(t);
  }, [active, reduce]);

  return (
    <AnimatePresence>
      {peek && (
        <motion.div
          key={peek.id}
          aria-hidden
          className="pointer-events-none absolute z-0"
          style={{ left: `${peek.pos}%`, top: -44 }}
          initial={{ y: 50 }}
          animate={{ y: 0 }}
          exit={{ y: 50 }}
          transition={{ type: "spring", stiffness: 240, damping: 17 }}
        >
          <Face />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Face() {
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el || mouse.x < 0) return;
      const r = el.getBoundingClientRect();
      const dx = mouse.x - (r.left + r.width / 2);
      const dy = mouse.y - (r.top + r.height * 0.6);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 120); // closer cursor → smaller movement
      setLook({ x: (dx / d) * k, y: (dy / d) * k });
    };
    update();
    return onMouse(update);
  }, []);

  const px = look.x * 2.4;
  const py = look.y * 2.2;
  return (
    <svg ref={ref} width="52" height="46" viewBox="0 0 52 46" style={{ transform: `rotate(${look.x * 6}deg)`, transition: "transform 120ms ease-out" }}>
      {/* ears */}
      <path d="M8 22 L10 2 L22 12Z" fill="#2B2540" />
      <path d="M44 22 L42 2 L30 12Z" fill="#2B2540" />
      <path d="M11 15 L12 7 L18 12Z" fill="#F4A6B8" />
      <path d="M41 15 L40 7 L34 12Z" fill="#F4A6B8" />
      {/* hood + face */}
      <ellipse cx="26" cy="28" rx="21" ry="18" fill="#2B2540" />
      <ellipse cx="26" cy="31" rx="17" ry="14.5" fill="#FFC9B8" />
      {/* cheeks */}
      <ellipse cx="14" cy="36" rx="3.4" ry="2.2" fill="#FF8FA3" opacity="0.55" />
      <ellipse cx="38" cy="36" rx="3.4" ry="2.2" fill="#FF8FA3" opacity="0.55" />
      {/* eyes */}
      <g className="peeker-blink">
        <ellipse cx="19" cy="29" rx="4.6" ry="5.4" fill="#fff" />
        <ellipse cx="33" cy="29" rx="4.6" ry="5.4" fill="#fff" />
        <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 90ms ease-out" }}>
          <ellipse cx="19" cy="29.5" rx="3.1" ry="3.7" fill="#5B3FD1" />
          <ellipse cx="33" cy="29.5" rx="3.1" ry="3.7" fill="#5B3FD1" />
          <circle cx="19" cy="30" r="1.7" fill="#1A1430" />
          <circle cx="33" cy="30" r="1.7" fill="#1A1430" />
          <circle cx="20.1" cy="27.8" r="1.1" fill="#fff" />
          <circle cx="34.1" cy="27.8" r="1.1" fill="#fff" />
        </g>
      </g>
      {/* smile */}
      <path d="M23.5 38 Q26 40.5 28.5 38" stroke="#7A3B3B" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
