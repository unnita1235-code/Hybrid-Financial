"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { mode, resolvedTheme, setMode, toggle } = useTheme();

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Toggle light and dark mode"
        title={`Current: ${resolvedTheme}`}
      >
        {resolvedTheme === "dark" ? (
          <Moon className="h-3.5 w-3.5" />
        ) : (
          <Sun className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">
          {resolvedTheme === "dark" ? "Dark" : "Light"}
        </span>
      </button>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as "light" | "dark" | "system")}
        aria-label="Theme mode"
        className="rounded bg-transparent px-1 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
