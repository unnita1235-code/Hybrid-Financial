"use client";

import { cn } from "@/lib/utils";

type RealitySimulationToggleProps = {
  /** When true, the next run uses scenario simulation. */
  simulation: boolean;
  onChange: (simulation: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * High-contrast mode switch: **Reality** (live) vs **Simulation** (what-if, rolled back).
 */
export function RealitySimulationToggle({
  simulation,
  onChange,
  disabled,
  className,
}: RealitySimulationToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0 rounded-lg border border-border/50 bg-muted p-0.5",
        className,
      )}
      role="group"
      aria-label="Data mode"
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!simulation}
        onClick={() => onChange(false)}
        className={cn(
          "shrink-0 rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !simulation
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Reality
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={simulation}
        onClick={() => onChange(true)}
        className={cn(
          "shrink-0 rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          simulation
            ? "bg-warning/20 text-warning border border-warning/40"
            : "text-muted-foreground hover:text-warning",
        )}
      >
        Simulation
      </button>
    </div>
  );
}
