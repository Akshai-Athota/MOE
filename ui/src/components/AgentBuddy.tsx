import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/** A little AI agent that sits in the middle behind a horizontal line, peeks over it and watches the cursor. */
export function AgentBuddy() {
  return (
    <div className="relative h-px w-full bg-line-strong">
      {/* clip box: everything below the line is hidden, so the agent looks like it's behind it */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[70px] overflow-hidden">
        <motion.div
          aria-hidden
          className="absolute bottom-0 left-1/2"
          style={{ x: "-50%" }}
          initial={{ y: 70 }}
          animate={{ y: 14 }}
          transition={{ type: "spring", stiffness: 200, damping: 16, delay: 0.4 }}
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

  const px = look.x * 3.2;
  const py = look.y * 2.4;
  return (
    <svg ref={ref} width="72" height="64" viewBox="0 0 72 64" style={{ transform: `rotate(${look.x * 7}deg)`, transformOrigin: "50% 100%", transition: "transform 140ms ease-out" }}>
      <defs>
        <linearGradient id="ab-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DCD8F0" />
        </linearGradient>
        <linearGradient id="ab-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E1B3A" />
          <stop offset="1" stopColor="#2E2457" />
        </linearGradient>
        <radialGradient id="ab-glow">
          <stop offset="0" stopColor="#7CF7E4" />
          <stop offset="1" stopColor="#7CF7E4" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* antenna with pulsing light */}
      <path d="M36 16 V7" stroke="#B4AEDA" strokeWidth="2" strokeLinecap="round" />
      <circle cx="36" cy="6" r="6" fill="url(#ab-glow)" className="agent-pulse" />
      <circle cx="36" cy="6" r="2.8" fill="#7CF7E4" />
      {/* side ear pods */}
      <rect x="3" y="30" width="7" height="14" rx="3.5" fill="#A79CF2" />
      <rect x="62" y="30" width="7" height="14" rx="3.5" fill="#A79CF2" />
      {/* head shell */}
      <rect x="8" y="15" width="56" height="46" rx="20" fill="url(#ab-shell)" stroke="#CFC9EC" />
      {/* visor screen */}
      <rect x="15" y="24" width="42" height="27" rx="12" fill="url(#ab-screen)" />
      <path d="M20 28 Q26 25.5 33 26" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* glowing eyes that follow the cursor */}
      <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 90ms ease-out" }}>
        <g className="peeker-blink">
          <rect x="23.5" y="32" width="7" height="9" rx="3.5" fill="#7CF7E4" />
          <rect x="41.5" y="32" width="7" height="9" rx="3.5" fill="#7CF7E4" />
          <circle cx="26" cy="34.5" r="1.2" fill="#fff" />
          <circle cx="44" cy="34.5" r="1.2" fill="#fff" />
        </g>
        {/* tiny smile */}
        <path d="M33 45 Q36 47.5 39 45" stroke="#7CF7E4" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>
      {/* blush */}
      <ellipse cx="17" cy="52" rx="3.5" ry="2" fill="#FF9EC0" opacity="0.6" />
      <ellipse cx="55" cy="52" rx="3.5" ry="2" fill="#FF9EC0" opacity="0.6" />
    </svg>
  );
}
