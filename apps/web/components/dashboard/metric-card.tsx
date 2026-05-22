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
        "glass-terminal rounded-lg",
        "px-4 py-3 transition hover:border-ring/50 hover:bg-primary/[0.05]",
        "focus:outline-none focus:ring-1 focus:ring-ring/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 font-numeric text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </p>
          {sublabel && <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isLive && (
            <span className="rounded border border-border bg-background/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              SQL
            </span>
          )}
          <span
            className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition group-hover:border-ring/50 group-hover:text-foreground"
            aria-hidden
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Database className="h-3 w-3" strokeWidth={1.5} />
        <span>Metric from query · open narrative context</span>
      </div>
    </button>
  );
}
