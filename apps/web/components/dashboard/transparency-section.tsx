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
          className="rounded border border-border bg-background/60 p-2 text-[10px] leading-relaxed"
        >
          <span className="font-mono text-muted-foreground">{c.source}</span>
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
    <div className="neon-card mb-4 space-y-4 rounded-lg border p-3 pb-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Transparency
      </p>
      <p className="text-xs text-muted-foreground">
        Provenance of this run{auditId ? ` · audit ${auditId.slice(0, 8)}…` : ""}
      </p>
      {data && (
        <>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Prompt template
            </p>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-2 font-mono text-[10px] text-foreground/80">
              {data.promptTemplate.slice(0, 2000)}
            </pre>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Model versions
            </p>
            <ul className="mt-1 font-mono text-[10px] text-foreground/80">
              {models.map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted-foreground">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              SQL (read-only)
            </p>
            <pre className="mt-1 max-h-24 overflow-auto rounded border border-border bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
              {data.sql}
            </pre>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              RAG chunks
            </p>
            <div className="mt-1 max-h-40 overflow-y-auto pr-1">
              <ChunkList chunks={data.ragChunks} />
            </div>
          </div>
        </>
      )}

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Was this response helpful? (feeds few-shot data)
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() => void handle(1)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs transition",
              submitted === "up"
                ? "border-emerald-500/50 text-emerald-400"
                : "text-muted-foreground hover:border-ring/60 hover:text-foreground",
            )}
            aria-label="Thumbs up"
          >
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} />
            Up
          </button>
          <button
            type="button"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() =>
              downOpen && correction.trim() ? void handle(-1) : setDownOpen(true)
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs transition",
              submitted === "down"
                ? "border-amber-500/50 text-amber-400"
                : "text-muted-foreground hover:border-ring/60 hover:text-foreground",
            )}
            aria-label="Thumbs down"
          >
            <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            Down
          </button>
        </div>
        {downOpen && submitted === null && (
          <div className="mt-2 space-y-1">
            <label className="text-[10px] text-muted-foreground" htmlFor="correction">
              What should the answer have been?
            </label>
            <textarea
              id="correction"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              rows={3}
              className="w-full resize-y rounded border border-border bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              placeholder="Correct figures, missing risk factors, or preferred wording for prompt tuning"
            />
            <button
              type="button"
              disabled={!correction.trim() || voteBusy}
              onClick={() => void handle(-1)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Submit correction
            </button>
          </div>
        )}
        {submitted && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Thanks — saved for few-shot review.
          </p>
        )}
      </div>
    </div>
  );
}
