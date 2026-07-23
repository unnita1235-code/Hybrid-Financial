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
        "flex max-h-40 min-h-[7rem] shrink-0 flex-col border-t border-border/50 bg-card",
        className,
      )}
    >
      <div className="border-b border-border/30 px-4 py-2 font-sans text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Agent console
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            Run a query to stream node phases (SQL, query, RAG, narrative).
          </p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.kind === "error" ? "text-destructive" : "text-success",
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
