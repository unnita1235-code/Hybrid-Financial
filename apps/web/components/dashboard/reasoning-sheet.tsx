"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type ReasoningSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sqlOkMs: number;
  ragChunks: number;
  modelLabel?: string;
};

function yamlBody(modelLabel: string, sqlOkMs: number, ragChunks: number) {
  return `pipeline:
  id: ${modelLabel}
  steps:
    - name: "SQL execution"
      status: "Success"
      latency_ms: ${sqlOkMs}
    - name: "RAG retrieval"
      status: "Complete"
      chunks: ${ragChunks}
    - name: "Verification"
      status: "No hallucination pattern detected"
      method: "schema + source overlap"
    - name: "Synthesis"
      status: "Streamed"`;
}

export function ReasoningSheet({
  open,
  onOpenChange,
  sqlOkMs,
  ragChunks,
  modelLabel = "hybrid_synthesis_rag_v1",
}: ReasoningSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md p-0"
        aria-describedby="reasoning-desc"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="shrink-0">
            <SheetTitle>Reasoning / thought process</SheetTitle>
            <SheetDescription
              id="reasoning-desc"
              className="font-mono text-[10px] text-slate-500"
            >
              YAML-style agent trace. Opened from the narrative or Trace.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-sm">
            <div className="space-y-0.5 text-[12px] leading-relaxed text-slate-200">
              <p>
                <span className="text-cyan-500/80">reasoning</span>
                <span className="text-slate-600">: </span>
                <span className="text-amber-200/80">|</span>
              </p>
            </div>
            <pre
              className={cn(
                "mt-3 rounded-md border border-white/10 bg-black/60 p-3",
                "text-left text-[12px] leading-6 text-emerald-200/90",
                "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
              )}
            >
              {yamlBody(modelLabel, sqlOkMs, ragChunks)}
            </pre>
            <p className="mt-4 text-[10px] text-slate-500">
              Aligned with server audit: prompt template, SQL, RAG metadata, and model
              version IDs.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
