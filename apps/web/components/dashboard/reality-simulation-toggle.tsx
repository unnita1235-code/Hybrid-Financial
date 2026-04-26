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
      className={cn("flex items-center gap-0 rounded-md p-0.5", className)}
      role="group"
      aria-label="Data mode"
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!simulation}
        onClick={() => onChange(false)}
        className={cn(
          "shrink-0 rounded px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition",
          !simulation
            ? "bg-white text-zinc-950"
            : "text-slate-500 hover:text-slate-300",
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
          "shrink-0 rounded px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition",
          simulation
            ? "bg-amber-400 text-zinc-950"
            : "text-slate-500 hover:text-amber-200/90",
        )}
      >
        Simulation
      </button>
    </div>
  );
}
