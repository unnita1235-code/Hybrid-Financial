"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <Card className="mb-4 space-y-4 p-4 pb-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Transparency
        </p>
        {auditId ? (
          <Badge variant="verified" title={`audit ${auditId}`}>
            audit {auditId.slice(0, 8)}…
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Provenance of this run
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
          <Button
            type="button"
            variant={submitted === "up" ? "default" : "secondary"}
            size="sm"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() => void handle(1)}
            aria-label="Thumbs up"
            className={cn(submitted === "up" && "border-success/50")}
          >
            <ThumbsUp className="h-4 w-4" strokeWidth={2} />
            Yes
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!auditId || disabled || voteBusy || submitted !== null}
            onClick={() =>
              downOpen && correction.trim() ? void handle(-1) : setDownOpen(true)
            }
            aria-label="Thumbs down"
            className={cn(submitted === "down" && "border-warning/50 text-warning")}
          >
            <ThumbsDown className="h-4 w-4" strokeWidth={2} />
            Flag discrepancy
          </Button>
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
              className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
              placeholder="Correct figures, missing risk factors, or preferred wording for prompt tuning"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!correction.trim() || voteBusy}
              onClick={() => void handle(-1)}
            >
              Submit correction
            </Button>
          </div>
        )}
        {submitted && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Thanks — saved for few-shot review.
          </p>
        )}
      </div>
    </Card>
  );
}
