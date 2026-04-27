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
        "border-b border-white/10 glass-terminal border-x-0 border-t-0 bg-zinc-950/40 px-4 py-3",
        className,
      )}
    >
      <form
        className="mx-auto flex max-w-3xl flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-slate-500">
          <span className="sr-only">Agent mode (reality only)</span>
          <button
            type="button"
            disabled={isBusy || simulation}
            onClick={() => setAgentMode("hybrid")}
            className={cn(
              "rounded border px-2 py-1 transition",
              !simulation && agentMode === "hybrid"
                ? "border-white/25 bg-slate-800/80 text-slate-200"
                : "border-white/5 bg-transparent text-slate-600",
              (isBusy || simulation) && "opacity-40",
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
              "rounded border px-2 py-1 transition",
              !simulation && agentMode === "temporal"
                ? "border-white/25 bg-slate-800/80 text-slate-200"
                : "border-white/5 bg-transparent text-slate-600",
              (isBusy || simulation) && "opacity-40",
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
            className="shrink-0 border border-white/15 bg-zinc-900/80"
          />
          <Link
            href="/reports"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400 transition hover:border-white/20 hover:text-slate-200"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
            Reports
          </Link>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
              strokeWidth={1.5}
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
                "w-full rounded-md border border-white/10 bg-slate-900/50 py-2.5 pl-9 pr-3",
                "font-mono text-sm text-slate-50 placeholder:text-slate-600",
                "outline-none transition focus:border-slate-500/50 focus:ring-1 focus:ring-slate-500/30",
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
            className="shrink-0 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            title="Start voice input"
          >
            <Mic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              voice.stop();
              applyTranscript();
            }}
            disabled={voice.state !== "listening"}
            className="shrink-0 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            title="Stop voice input"
          >
            <MicOff className="h-3.5 w-3.5" />
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="shrink-0 rounded-md border border-white/20 bg-white px-4 py-2.5 text-xs font-medium tracking-wide text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
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
                "w-full rounded-md border-2 border-dashed border-amber-400/50 bg-zinc-900/50 py-2 px-3",
                "font-mono text-sm text-amber-100 placeholder:text-amber-200/40",
                "outline-none focus:border-amber-400/80 focus:ring-1 focus:ring-amber-500/20",
                "disabled:opacity-50",
              )}
              aria-label="What-if scenario"
              autoComplete="off"
            />
            <p className="mt-1 text-[10px] font-mono text-amber-200/50">
              Simulation runs a rolled-back UPDATE + your read query. Core data is never
              committed.
            </p>
          </div>
        )}
        {voice.error && (
          <p className="text-[10px] text-destructive">
            {voice.error} Voice features fallback to typed input.
          </p>
        )}
      </form>
    </div>
  );
}
