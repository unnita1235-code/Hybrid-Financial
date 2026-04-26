"use client";

import { Bookmark, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const SAVED = [
  { id: "1", name: "TTM revenue vs. prior year" },
  { id: "2", name: "Index correlation — SPX / flow" },
  { id: "3", name: "Filings: risk factors (10-K)" },
] as const;

type SavedReportsSidebarProps = {
  onSelect: (id: string) => void;
  className?: string;
};

export function SavedReportsSidebar({ onSelect, className }: SavedReportsSidebarProps) {
  return (
    <aside
      className={cn(
        "flex w-56 shrink-0 flex-col border-r border-white/10 bg-zinc-950/40 backdrop-blur-2xl",
        className,
      )}
    >
      <div className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2 text-slate-500">
          <Bookmark className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em]">
            Saved reports
          </span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {SAVED.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className="flex w-full items-start gap-2 rounded border border-transparent px-2 py-2 text-left text-xs text-slate-400 transition hover:border-white/10 hover:bg-white/5 hover:text-slate-200"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                <span className="leading-snug">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
