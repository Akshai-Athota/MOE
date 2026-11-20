import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/** A little mouse that sits behind a horizontal line, peeks over it and watches the cursor.
 *  Now and then it scurries to a new spot along the line. */
export function MouseBuddy() {
  const reduce = useReducedMotion();
  const [pos, setPos] = useState(50);
  const [up, setUp] = useState(true);

  useEffect(() => {
    if (reduce) return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setUp(false); // duck, move, pop up again
        t = window.setTimeout(() => {
          setPos(8 + Math.random() * 84);
          t = window.setTimeout(() => {
            setUp(true);
            loop();
          }, 700);
        }, 350);
      }, 7000 + Math.random() * 8000);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [reduce]);

  return (
    <div className="relative h-px w-full bg-line-strong">
      {/* clip box: everything below the line is hidden, so the mouse looks like it's behind it */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[60px] overflow-hidden">
        <motion.div
          aria-hidden
          className="absolute bottom-0"
          animate={{ left: `${pos}%`, y: up ? 6 : 60 }}
          transition={{ left: { duration: 0.6, ease: "easeInOut" }, y: { type: "spring", stiffness: 260, damping: 18 } }}
          style={{ x: "-50%" }}
        >
          <Face />
        </motion.div>
      </div>
    </div>
  );
}

function Face() {
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.55);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 140);
      setLook({ x: (dx / d) * k, y: (dy / d) * k });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const px = look.x * 2.6;
  const py = look.y * 2.4;
  return (
    <svg ref={ref} width="72" height="58" viewBox="0 0 72 58" style={{ transform: `rotate(${look.x * 7}deg)`, transformOrigin: "50% 100%", transition: "transform 140ms ease-out" }}>
      {/* ears */}
      <circle cx="14" cy="18" r="13" fill="#B9B4C7" />
      <circle cx="58" cy="18" r="13" fill="#B9B4C7" />
      <circle cx="14" cy="18" r="8.5" fill="#FFB8C6" />
      <circle cx="58" cy="18" r="8.5" fill="#FFB8C6" />
      {/* head */}
      <ellipse cx="36" cy="38" rx="23" ry="20" fill="#CFCADB" />
      <ellipse cx="36" cy="44" rx="15" ry="11" fill="#E6E2EE" />
      {/* cheeks */}
      <ellipse cx="20" cy="44" rx="3.6" ry="2.3" fill="#FF8FA3" opacity="0.55" />
      <ellipse cx="52" cy="44" rx="3.6" ry="2.3" fill="#FF8FA3" opacity="0.55" />
      {/* eyes */}
      <g className="peeker-blink">
        <ellipse cx="27" cy="35" rx="5" ry="6" fill="#fff" />
        <ellipse cx="45" cy="35" rx="5" ry="6" fill="#fff" />
        <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 90ms ease-out" }}>
          <ellipse cx="27" cy="35.5" rx="3.4" ry="4" fill="#2A2238" />
          <ellipse cx="45" cy="35.5" rx="3.4" ry="4" fill="#2A2238" />
          <circle cx="28.3" cy="33.6" r="1.3" fill="#fff" />
          <circle cx="46.3" cy="33.6" r="1.3" fill="#fff" />
        </g>
      </g>
      {/* nose + mouth */}
      <ellipse cx="36" cy="43" rx="2.6" ry="2" fill="#F07A93" />
      <path d="M33 46.5 Q36 49 39 46.5" stroke="#6E5A6E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* whiskers */}
      <g stroke="#8F879F" strokeWidth="0.9" strokeLinecap="round">
        <path d="M24 45 L10 43" /><path d="M24 47 L11 49" />
        <path d="M48 45 L62 43" /><path d="M48 47 L61 49" />
      </g>
    </svg>
  );
}
