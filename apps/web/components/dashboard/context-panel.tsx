"use client";

import { Brain, X } from "lucide-react";
import { InlineSparkline } from "@/components/dashboard/inline-sparkline";
import { NarrativeWithSqlTooltips } from "@/components/dashboard/narrative-sql-numbers";
import { TransparencySection } from "@/components/dashboard/transparency-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
          "fixed right-0 top-0 z-50 flex h-full w-full flex-col",
          "border-l border-border bg-card",
          "sm:max-w-[380px]",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="complementary"
        aria-label="Evidence and provenance inspector"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/30 px-4 py-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {title}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant={isStreaming ? "primary" : narrative ? "verified" : "default"}>
                {isStreaming ? "Streaming" : narrative ? "Completed" : "Ready"}
              </Badge>
              <p className="truncate text-xs text-muted-foreground">
                {isStreaming
                  ? "Streaming response…"
                  : "Click the answer for step-by-step trace"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenReasoning}
              aria-label="Open reasoning trace"
            >
              <Brain className="h-4 w-4" strokeWidth={2} aria-hidden />
              Trace
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              aria-label="Close evidence panel"
              className="px-2.5"
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TransparencySection
            data={transparency}
            auditId={auditId}
            onFeedback={onFeedback}
            disabled={isStreaming}
          />
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Narrative
          </p>
          {isStreaming && !narrative && (
            <p className="font-sans text-sm text-muted-foreground" role="status">
              Awaiting text…
            </p>
          )}
          <Card
            className={cn(
              "p-3",
              narrative && !isStreaming
                ? "cursor-pointer border-dashed border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10"
                : "cursor-default",
            )}
          >
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
              aria-label={narrative ? "Open reasoning trace for this answer" : "Narrative answer"}
            >
            <div className="after:block after:clear-both after:content-['']">
              {chartData && chartData.length > 0 && (
                <span
                  className="float-right ml-3 inline-block pl-1"
                  title="Series spark from returned rows"
                  aria-hidden
                >
                  <InlineSparkline
                    data={chartData}
                    width={150}
                    height={20}
                    className="opacity-80"
                    strokeClassName="stroke-primary/50"
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
              <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-primary/60 align-middle" aria-hidden />
            )}
            </div>
          </Card>
          {narrative && !isStreaming && (
            <p className="mt-3 text-xs text-muted-foreground">
              Tip: click anywhere on the answer, or &quot;Trace&quot;, to open the
              pipeline YAML.
            </p>
          )}
          {sources && (
            <div className="mt-6 space-y-3 border-t border-border/30 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Sources
              </p>
              <pre className="max-h-32 overflow-auto rounded-md border border-border/50 bg-muted p-3 font-mono text-xs leading-tight text-muted-foreground">
                {sources.sql}
              </pre>
              {sources.documentHints && sources.documentHints.length > 0 && (
                <ul className="list-inside list-disc text-sm text-muted-foreground">
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
