"use client";

import { ChevronRight, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
    <Card
      // button semantics preserved via nested button for a11y; whole card is clickable
      className={cn(
        "group w-full p-0 text-left transition hover:border-primary/30 hover:bg-primary/5",
        "focus-within:ring-2 focus-within:ring-ring/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpenContext}
        className="block w-full rounded-lg px-5 py-4 text-left focus:outline-none"
        aria-label={`${label}: ${value}. Open narrative context.`}
      >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-numeric text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
          {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {isLive && (
            <Badge variant="primary" className="uppercase tracking-wider">
              SQL
            </Badge>
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
        <Database className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        <span>Metric from query · open narrative context</span>
      </div>
      </button>
    </Card>
  );
}
