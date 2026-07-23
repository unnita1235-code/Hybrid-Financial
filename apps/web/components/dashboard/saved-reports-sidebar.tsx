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
        "flex w-56 shrink-0 flex-col border-r border-border/50 bg-card backdrop-blur-md",
        className,
      )}
    >
      <div className="border-b border-border/30 px-4 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Bookmark className="h-4 w-4" strokeWidth={2} />
          <span className="text-xs font-semibold uppercase tracking-[0.12em]">
            Saved reports
          </span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {SAVED.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className="flex w-full items-start gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-border/50 hover:bg-primary/5 hover:text-foreground"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="leading-snug">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
