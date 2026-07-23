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
        "px-5 py-4 transition hover:border-primary/30 hover:bg-primary/5 hover:shadow-lg",
        "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-0",
        "border border-border/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-numeric text-3xl font-bold tabular-nums text-foreground">
            {value}
          </p>
          {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          {isLive && (
            <span className="rounded-sm border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              SQL
            </span>
          )}
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition group-hover:border-primary/50 group-hover:bg-primary/10 group-hover:text-primary"
            aria-hidden
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Database className="h-3.5 w-3.5" strokeWidth={2} />
        <span>Metric from query · open narrative context</span>
      </div>
    </button>
  );
}
