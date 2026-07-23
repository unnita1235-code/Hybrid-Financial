"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import type { RagChunkSummary, TransparencyPayload } from "@/lib/insight-stream";
import { cn } from "@/lib/utils";

type Props = {
  data: TransparencyPayload | null;
  auditId: string | null;
  onFeedback: (vote: 1 | -1, correction?: string) => Promise<void>;
  disabled?: boolean;
};

function ChunkList({ chunks }: { chunks: RagChunkSummary[] }) {
  if (!chunks.length) return <p className="text-xs text-muted-foreground">No RAG rows.</p>;
  return (
    <ul className="space-y-2">
      {chunks.map((c) => (
        <li
          key={c.id ?? c.source}
          className="rounded-lg border border-border/50 bg-card p-3 text-xs leading-relaxed"
        >
          <span className="font-mono text-muted-foreground text-xs">{c.source}</span>
          <p className="mt-1 text-foreground/80">{c.content_preview}</p>
        </li>
      ))}
    </ul>
  );
}

export function TransparencySection({ data, auditId, onFeedback, disabled }: Props) {
  const [voteBusy, setVoteBusy] = useState(false);
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [downOpen, setDownOpen] = useState(false);
  const [correction, setCorrection] = useState("");

  if (!data && !auditId) return null;

  const models = data?.modelVersions ? Object.entries(data.modelVersions) : [];

  const handle = async (v: 1 | -1) => {
    if (!auditId || voteBusy) return;
    if (v === -1) {
      if (!downOpen) {
        setDownOpen(true);
        return;
      }
      if (!correction.trim()) return;
    }
    setVoteBusy(true);
    try {
      await onFeedback(v, v === -1 ? correction.trim() : undefined);
      setSubmitted(v === 1 ? "up" : "down");
      setDownOpen(false);
    } finally {
      setVoteBusy(false);
    }
  };

  return (
    <div className="glass-terminal mb-4 space-y-4 rounded-lg border border-border/50 p-4 pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Transparency
      </p>
      <p className="text-xs text-muted-foreground">
        Provenance of this run{auditId ? ` · audit ${auditId.slice(0, 8)}…` : ""}
      </p>
      {data && (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Prompt template
            </p>
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-card p-3 font-mono text-xs text-muted-foreground/80">
              {data.promptTemplate.slice(0, 2000)}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Model versions
            </p>
            <ul className="mt-2 font-mono text-xs text-muted-foreground/80">
              {models.map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted-foreground/60">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              SQL (read-only)
            </p>
            <pre className="mt-2 max-h-24 overflow-auto rounded-lg border border-border/50 bg-card p-3 font-mono text-xs text-muted-foreground/70">
              {data.sql}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              RAG chunks
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto pr-1">
              <ChunkList chunks={data.ragChunks} />
            </div>
          </div>
        </>
      )}

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Was this response helpful? (feeds few-shot data)
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() => void handle(1)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              submitted === "up"
                ? "border-success/50 text-success"
                : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-primary/5",
            )}
            aria-label="Thumbs up"
          >
            <ThumbsUp className="h-4 w-4" strokeWidth={2} />
            Up
          </button>
          <button
            type="button"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() =>
              downOpen && correction.trim() ? void handle(-1) : setDownOpen(true)
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              submitted === "down"
                ? "border-warning/50 text-warning"
                : "border-border/50 text-muted-foreground hover:border-warning/40 hover:text-foreground hover:bg-warning/5",
            )}
            aria-label="Thumbs down"
          >
            <ThumbsDown className="h-4 w-4" strokeWidth={2} />
            Down
          </button>
        </div>
        {downOpen && submitted === null && (
          <div className="mt-3 space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="correction">
              What should the answer have been?
            </label>
            <textarea
              id="correction"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border/50 bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground"
              placeholder="Correct figures, missing risk factors, or preferred wording for prompt tuning"
            />
            <button
              type="button"
              disabled={!correction.trim() || voteBusy}
              onClick={() => void handle(-1)}
              className="text-xs text-slate-400 underline hover:text-slate-200"
            >
              Submit correction
            </button>
          </div>
        )}
        {submitted && (
          <p className="mt-2 text-[10px] text-slate-600">
            Thanks — saved for few-shot review.
          </p>
        )}
      </div>
    </div>
  );
}
