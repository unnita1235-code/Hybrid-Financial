"use client";

import Link from "next/link";
import { FileText, Mic, MicOff, Search } from "lucide-react";
import { useCallback, useState } from "react";
import { RealitySimulationToggle } from "@/components/dashboard/reality-simulation-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        "border-b border-border/50 bg-background px-4 py-4",
        className,
      )}
    >
      <form
        className="mx-auto flex w-full max-w-3xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="sr-only">Agent mode (reality only)</span>
          <Badge variant={!simulation && agentMode === "hybrid" ? "primary" : "default"}>
            {simulation ? "Hybrid insight (simulation forces hybrid)" : agentMode === "hybrid" ? "Insight Mode" : "Compare Scenarios"}
          </Badge>
          <button
            type="button"
            disabled={isBusy || simulation}
            onClick={() => setAgentMode("hybrid")}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
              !simulation && agentMode === "hybrid"
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border/40 bg-card text-muted-foreground hover:border-border/60 hover:text-foreground",
              (isBusy || simulation) && "opacity-50",
            )}
            title="Architect → SQL + vector RAG + synthesis"
            aria-pressed={agentMode === "hybrid"}
          >
            Hybrid insight
          </button>
          <button
            type="button"
            disabled={isBusy || simulation}
            onClick={() => setAgentMode("temporal")}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
              !simulation && agentMode === "temporal"
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border/40 bg-card text-muted-foreground hover:border-border/60 hover:text-foreground",
              (isBusy || simulation) && "opacity-50",
            )}
            title="Two-period SQL + delta + targeted RAG (WebSocket)"
            aria-pressed={agentMode === "temporal"}
          >
            Compare
          </button>
        </div>
        <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <RealitySimulationToggle
            simulation={simulation}
            onChange={setSimulation}
            disabled={isBusy}
            className="shrink-0"
          />
          <Link
            href="/reports"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/50 bg-card px-3 py-2 font-sans text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          >
            <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
            Reports
          </Link>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
              aria-hidden
            />
            <Input
              value={v}
              onChange={(e) => setV(e.target.value)}
              disabled={isBusy}
              placeholder={
                simulation
                  ? "SQL agent question (e.g. TTM revenue from transactions)…"
                  : "Ask in natural language — run SQL, then RAG context streams in…"
              }
              className="w-full py-2.5 pl-10 pr-4"
              aria-label="Natural language query"
              autoComplete="off"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={voice.start}
            disabled={!voice.supported || isBusy || voice.state === "listening"}
            title="Start voice input"
            aria-label="Start voice input"
            className="px-2.5"
          >
            <Mic className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              voice.stop();
              applyTranscript();
            }}
            disabled={voice.state !== "listening"}
            title="Stop voice input and insert transcript"
            aria-label="Stop voice input"
            className="px-2.5"
          >
            <MicOff className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="min-h-[44px] px-4"
          >
            {isBusy ? "Running…" : "Run"}
          </Button>
          </div>
        </div>
        </Card>
        {simulation && (
          <div className="w-full min-w-0">
            <Input
              value={whatIf}
              onChange={(e) => setWhatIf(e.target.value)}
              disabled={isBusy}
              placeholder='What if… (e.g. "material costs increase 15% next quarter")'
              className="w-full border-warning/40 focus-visible:border-warning/60 focus-visible:ring-warning/20"
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
          <p className="text-[11px] font-medium text-destructive" role="alert">
            {voice.error} Voice features fallback to typed input.
          </p>
        )}
      </form>
    </div>
  );
}
