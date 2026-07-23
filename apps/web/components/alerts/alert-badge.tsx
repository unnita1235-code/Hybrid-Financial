"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type AlertCountResponse = {
  unread: number;
};

export function AlertBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const res = await fetch("/api/alerts/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as AlertCountResponse;
        if (mounted) setCount(Math.max(0, Number(data.unread ?? 0)));
      } catch {
        // Keep badge silent on transient fetch errors.
      }
    };

    void load();
    const id = setInterval(() => {
      void load();
    }, 60_000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/alerts"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
      aria-label="Open alerts"
      title="Alerts"
    >
      <Bell className="h-5 w-5" strokeWidth={2} />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-destructive/30 bg-destructive px-1 text-xs font-bold leading-none text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
