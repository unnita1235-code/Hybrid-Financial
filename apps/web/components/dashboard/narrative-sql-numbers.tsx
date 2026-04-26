"use client";

import { Fragment, type PointerEvent, type ReactNode, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NUM_RE =
  /(\$[\d,.]+(?:M|B|K|m|k)?|[-]?\d+\.?\d*%|(?:\d{1,3},)+\d{3,}|\b\d+\.\d{1,2}\b)/g;

type NarrativeWithSqlTooltipsProps = {
  text: string;
  sql: string;
  className?: string;
  onNumberPointerDown?: (e: PointerEvent) => void;
};

/**
 * Wraps currency-like and numeric substrings; hover shows the generating SQL.
 */
export function NarrativeWithSqlTooltips({
  text,
  sql,
  className,
  onNumberPointerDown,
}: NarrativeWithSqlTooltipsProps) {
  const parts = useMemo(() => {
    if (!text) return [] as (string | { n: true; v: string })[];
    const out: (string | { n: true; v: string })[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(NUM_RE.source, "g");
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        out.push(text.slice(last, m.index));
      }
      out.push({ n: true, v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      out.push(text.slice(last));
    }
    return out;
  }, [text]);

  const content: ReactNode = parts.map((p, i) => {
    if (typeof p === "string") {
      return <Fragment key={i}>{p}</Fragment>;
    }
    return (
      <Tooltip key={i}>
        <TooltipTrigger asChild>
          <span
            onPointerDown={onNumberPointerDown}
            className={cn(
              "font-numeric cursor-help border-b border-dotted border-cyan-500/50 text-[0.95em] tabular-nums text-cyan-100/95",
            )}
          >
            {p.v}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-lg font-mono text-[10px] leading-relaxed text-slate-200"
        >
          <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-500">
            Source query (read-only)
          </p>
          <pre className="whitespace-pre-wrap break-words text-slate-300">{sql}</pre>
        </TooltipContent>
      </Tooltip>
    );
  });

  return <span className={cn("whitespace-pre-wrap", className)}>{content}</span>;
}
