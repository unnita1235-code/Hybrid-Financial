"use client";

type StreamOutputProps = {
  text: string;
  isStreaming?: boolean;
};

export function StreamOutput({ text, isStreaming = false }: StreamOutputProps) {
  return (
    <div className="rounded-md border border-white/10 bg-zinc-900/40 p-3">
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
        {text || "..."}
      </p>
      {isStreaming && <p className="mt-2 text-xs text-slate-500">Streaming...</p>}
    </div>
  );
}
