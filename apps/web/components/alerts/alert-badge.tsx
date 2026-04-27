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
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-zinc-900/50 text-slate-300 transition hover:border-white/20 hover:text-slate-100"
      aria-label="Open alerts"
      title="Alerts"
    >
      <Bell className="h-4.5 w-4.5" strokeWidth={1.8} />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-red-300/20 bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
