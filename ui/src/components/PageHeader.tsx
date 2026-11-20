import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-6 lg:px-8 lg:pt-8">
      <div>
        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-500">{eyebrow}</div>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-tight lg:text-[30px]">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[14px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
