"use client";

import { ChevronRight, Database } from "lucide-react";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  sublabel?: string;
  isLive?: boolean;
  onOpenContext: () => void;
  className?: string;
};

export function MetricCard({
  label,
  value,
  sublabel,
  isLive,
  onOpenContext,
  className,
}: MetricCardProps) {
  return (
    <button
      type="button"
      onClick={onOpenContext}
      className={cn(
        "group w-full text-left",
        "glass-terminal rounded-md",
        "px-4 py-3 transition hover:border-cyan-500/20 hover:bg-cyan-500/[0.04]",
        "focus:outline-none focus:ring-1 focus:ring-slate-500/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            {label}
          </p>
          <p className="mt-0.5 font-numeric text-2xl font-semibold tabular-nums text-white">
            {value}
          </p>
          {sublabel && <p className="mt-0.5 text-xs text-slate-500">{sublabel}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isLive && (
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-500">
              SQL
            </span>
          )}
          <span
            className="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-slate-500 transition group-hover:border-slate-500/50 group-hover:text-slate-300"
            aria-hidden
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
        <Database className="h-3 w-3" strokeWidth={1.5} />
        <span>Metric from query · open narrative context</span>
      </div>
    </button>
  );
}
