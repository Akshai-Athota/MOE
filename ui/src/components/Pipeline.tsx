import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "./ui";

/** Animated processing pipeline (upload -> transcribe/OCR -> redact -> extract -> compare). */
export function Pipeline({ open, title, steps, onDone }: { open: boolean; title: string; steps: string[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) return setI(0);
    if (i >= steps.length) {
      const t = setTimeout(onDone, 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setI((x) => x + 1), 650);
    return () => clearTimeout(t);
  }, [open, i, steps.length, onDone]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ scale: 0.94, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-4 font-bold">{title}</div>
            <div className="space-y-2.5">
              {steps.map((s, k) => (
                <div key={s} className={cx("flex items-center gap-3 rounded-2xl p-2.5 text-[14px] transition", k < i ? "bg-mint-50" : k === i ? "bg-brand-50" : "opacity-40")}>
                  <span className={cx("grid h-7 w-7 place-items-center rounded-xl", k < i ? "bg-mint-500 text-white" : "bg-white text-brand-500")}>
                    {k < i ? <Check size={14} /> : k === i ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[11px] font-bold">{k + 1}</span>}
                  </span>
                  {s}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
