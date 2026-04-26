"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type AgentTerminalLine = {
  id: string;
  text: string;
  kind?: "log" | "error";
};

type AgentTerminalProps = {
  lines: AgentTerminalLine[];
  className?: string;
};

export function AgentTerminal({ lines, className }: AgentTerminalProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      className={cn(
        "flex max-h-40 min-h-[7rem] shrink-0 flex-col border-t border-white/10 bg-black/80",
        className,
      )}
    >
      <div className="border-b border-white/5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-widest text-slate-500">
        Agent console
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-slate-600">
            Run a query to stream node phases (SQL, query, RAG, narrative).
          </p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.kind === "error" ? "text-rose-400/90" : "text-emerald-400/90",
              )}
            >
              {line.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
