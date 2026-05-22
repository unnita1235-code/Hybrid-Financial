"use client";

import { Brain, X } from "lucide-react";
import { InlineSparkline } from "@/components/dashboard/inline-sparkline";
import { NarrativeWithSqlTooltips } from "@/components/dashboard/narrative-sql-numbers";
import { TransparencySection } from "@/components/dashboard/transparency-section";
import type { TransparencyPayload } from "@/lib/insight-stream";
import { cn } from "@/lib/utils";

type ContextPanelProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  narrative: string;
  isStreaming: boolean;
  sources?: {
    sql: string;
    documentHints?: string[];
  };
  transparency: TransparencyPayload | null;
  auditId: string | null;
  onFeedback: (vote: 1 | -1, correction?: string) => Promise<void>;
  /** Read-only SQL used for this answer (number tooltips) */
  sql: string;
  /** Inline trend next to the narrative */
  chartData: { t: string; v: number }[] | null;
  onOpenReasoning: () => void;
};

export function ContextPanel({
  open,
  onClose,
  title = "Narrative & transparency",
  narrative,
  isStreaming,
  sources,
  transparency,
  auditId,
  onFeedback,
  sql,
  chartData,
  onOpenReasoning,
}: ContextPanelProps) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col",
          "neon-card transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="complementary"
        aria-label="RAG narrative and transparency"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {title}
            </p>
            <p className="text-xs text-muted-foreground">
              {isStreaming ? "Streaming…" : "Click the answer for step-by-step trace"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenReasoning}
              className="flex h-8 items-center gap-1 rounded border border-primary/40 px-2 text-[10px] font-mono text-primary transition hover:border-primary/70 hover:bg-primary/10"
            >
              <Brain className="h-3.5 w-3.5" strokeWidth={1.5} />
              Trace
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground transition hover:border-ring/60 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TransparencySection
            data={transparency}
            auditId={auditId}
            onFeedback={onFeedback}
            disabled={isStreaming}
          />
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Narrative
          </p>
          {isStreaming && !narrative && (
            <p className="font-mono text-sm text-slate-500">Awaiting text…</p>
          )}
          <div
            role="button"
            tabIndex={narrative ? 0 : -1}
            onClick={() => {
              if (narrative && !isStreaming) onOpenReasoning();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (narrative && !isStreaming) onOpenReasoning();
              }
            }}
            className={cn(
              "rounded-md border border-border p-2 transition",
              narrative && !isStreaming
                ? "neon-hover cursor-pointer border-dashed border-primary/30 bg-primary/[0.05] hover:border-primary/60"
                : "cursor-default",
            )}
          >
            <div className="after:block after:clear-both after:content-['']">
              {chartData && chartData.length > 0 && (
                <span
                  className="float-right ml-2 inline-block pl-0.5"
                  title="TTM / series spark"
                  aria-hidden
                >
                  <InlineSparkline
                    data={chartData}
                    width={150}
                    height={20}
                    className="opacity-85"
                    strokeClassName="stroke-primary/70"
                  />
                </span>
              )}
              <NarrativeWithSqlTooltips
                text={narrative}
                sql={sql}
                onNumberPointerDown={(e) => e.stopPropagation()}
              />
            </div>
            {isStreaming && (
              <span className="live-pulse ml-0.5 inline-block h-3 w-0.5 bg-primary/80 align-middle" />
            )}
          </div>
          {narrative && !isStreaming && (
            <p className="mt-2 text-[9px] text-muted-foreground">
              Tip: click anywhere on the answer, or &quot;Trace&quot;, to open the
              pipeline YAML.
            </p>
          )}
          {sources && (
            <div className="mt-6 space-y-3 border-t border-border pt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Sources
              </p>
              <pre className="max-h-32 overflow-x-auto overflow-y-auto rounded border border-border bg-background/60 p-2 text-[10px] leading-tight text-muted-foreground">
                {sources.sql}
              </pre>
              {sources.documentHints && sources.documentHints.length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {sources.documentHints.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
