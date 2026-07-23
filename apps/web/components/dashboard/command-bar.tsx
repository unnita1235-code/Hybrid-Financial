"use client";

import Link from "next/link";
import { FileText, Mic, MicOff, Search } from "lucide-react";
import { useCallback, useState } from "react";
import { RealitySimulationToggle } from "@/components/dashboard/reality-simulation-toggle";
import { useVoiceInput } from "@/lib/hooks/use-voice-input";
import { cn } from "@/lib/utils";

export type CommandRunOptions = {
  simulation: boolean;
  /** Required when `simulation` is true. */
  whatIf?: string;
  /**
   * `hybrid` — Text-to-SQL + RAG + streaming narrative (default).
   * `temporal` — time-period compare agent (WebSocket, checkpointed).
   */
  agentMode: "hybrid" | "temporal";
};

type CommandBarProps = {
  onRun: (query: string, options: CommandRunOptions) => void;
  isBusy: boolean;
  className?: string;
};

export function CommandBar({ onRun, isBusy, className }: CommandBarProps) {
  const [v, setV] = useState("");
  const [simulation, setSimulation] = useState(false);
  const [whatIf, setWhatIf] = useState("");
  const [agentMode, setAgentMode] = useState<"hybrid" | "temporal">("hybrid");
  const voice = useVoiceInput();

  const submit = useCallback(() => {
    const q = v.trim();
    if (!q || isBusy) return;
    if (simulation && !whatIf.trim()) return;
    onRun(q, {
      simulation,
      whatIf: whatIf.trim() || undefined,
      agentMode: simulation ? "hybrid" : agentMode,
    });
  }, [v, isBusy, onRun, simulation, whatIf, agentMode]);

  const canSubmit = !!v.trim() && !isBusy && (!simulation || !!whatIf.trim());

  const applyTranscript = useCallback(() => {
    if (!voice.transcript.trim()) return;
    setV((prev) =>
      prev.trim()
        ? `${prev.trim()} ${voice.transcript.trim()}`
        : voice.transcript.trim(),
    );
    voice.setTranscript("");
  }, [voice]);

  return (
    <div
      className={cn(
        "border-b border-border/50 glass-terminal border-x-0 border-t-0 bg-background/80 px-4 py-4",
        className,
      )}
    >
      <form
        className="mx-auto flex max-w-3xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="sr-only">Agent mode (reality only)</span>
          <button
            type="button"
            disabled={isBusy || simulation}
            onClick={() => setAgentMode("hybrid")}
            className={cn(
              "rounded-lg border px-3 py-1.5 transition font-medium",
              !simulation && agentMode === "hybrid"
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border/40 bg-card text-muted-foreground hover:border-border/60 hover:text-foreground",
              (isBusy || simulation) && "opacity-50",
            )}
            title="Architect → SQL + vector RAG + synthesis"
          >
            Hybrid insight
          </button>
          <button
            type="button"
            disabled={isBusy || simulation}
            onClick={() => setAgentMode("temporal")}
            className={cn(
              "rounded-lg border px-3 py-1.5 transition font-medium",
              !simulation && agentMode === "temporal"
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border/40 bg-card text-muted-foreground hover:border-border/60 hover:text-foreground",
              (isBusy || simulation) && "opacity-50",
            )}
            title="Two-period SQL + delta + targeted RAG (WebSocket)"
          >
            Compare
          </button>
        </div>
        <div className="flex items-center gap-2">
          <RealitySimulationToggle
            simulation={simulation}
            onChange={setSimulation}
            disabled={isBusy}
            className="shrink-0 border border-border/50 bg-card"
          />
          <Link
            href="/reports"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-card px-3 py-2 font-sans text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <FileText className="h-4 w-4" strokeWidth={2} />
            Reports
          </Link>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <input
              value={v}
              onChange={(e) => setV(e.target.value)}
              disabled={isBusy}
              placeholder={
                simulation
                  ? "SQL agent question (e.g. TTM revenue from transactions)…"
                  : "Ask in natural language — run SQL, then RAG context streams in…"
              }
              className={cn(
                "w-full rounded-lg border border-border/50 bg-card py-2.5 pl-10 pr-4",
                "font-sans text-sm text-foreground placeholder:text-muted-foreground",
                "outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/30",
                "disabled:opacity-50",
              )}
              aria-label="Command search"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={voice.start}
            disabled={!voice.supported || isBusy || voice.state === "listening"}
            className="shrink-0 rounded-lg border border-border/50 bg-card px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground hover:border-primary/40 disabled:opacity-40"
            title="Start voice input"
          >
            <Mic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              voice.stop();
              applyTranscript();
            }}
            disabled={voice.state !== "listening"}
            className="shrink-0 rounded-lg border border-border/50 bg-card px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground hover:border-primary/40 disabled:opacity-40"
            title="Stop voice input"
          >
            <MicOff className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="shrink-0 rounded-lg border border-primary/50 bg-primary px-4 py-2.5 text-xs font-semibold tracking-wide text-primary-foreground transition hover:bg-primary/90 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isBusy ? "Running…" : "Run"}
          </button>
        </div>
        {simulation && (
          <div className="w-full min-w-0">
            <input
              value={whatIf}
              onChange={(e) => setWhatIf(e.target.value)}
              disabled={isBusy}
              placeholder='What if… (e.g. "material costs increase 15% next quarter")'
              className={cn(
                "w-full rounded-lg border-2 border-warning/40 bg-card py-2.5 px-4",
                "font-sans text-sm text-foreground placeholder:text-muted-foreground",
                "outline-none focus:border-warning/60 focus:ring-2 focus:ring-warning/30",
                "disabled:opacity-50",
              )}
              aria-label="What-if scenario"
              autoComplete="off"
            />
            <p className="mt-2 text-[11px] font-sans text-muted-foreground">
              Simulation runs a rolled-back UPDATE + your read query. Core data is never
              committed.
            </p>
          </div>
        )}
        {voice.error && (
          <p className="text-[11px] text-destructive font-medium">
            {voice.error} Voice features fallback to typed input.
          </p>
        )}
      </form>
    </div>
  );
}
