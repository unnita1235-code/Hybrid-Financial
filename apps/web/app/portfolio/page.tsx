"use client";

import { useEffect, useState } from "react";
import { PageTemplate } from "@/components/layout/page-template";

type PortfolioSummary = {
  positions: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
};

export default function PortfolioPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("/api/portfolio/summary", { cache: "no-store" });
        if (!res.ok) throw new Error(`Portfolio request failed (${res.status})`);
        const data = (await res.json()) as PortfolioSummary;
        if (mounted) setSummary(data);
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Failed to load portfolio");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <PageTemplate
      title="Portfolio tracker"
      subtitle="Monitor positions and run portfolio-level analysis."
      maxWidthClassName="max-w-5xl"
    >
      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="neon-card neon-hover mt-4 rounded-xl p-6 text-base leading-6 text-foreground/90">
        {summary ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Positions</dt>
              <dd className="mt-1 font-numeric text-2xl tabular-nums text-foreground">{summary.positions}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Market value</dt>
              <dd className="mt-1 font-numeric text-2xl tabular-nums text-foreground">{summary.market_value}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Cost basis</dt>
              <dd className="mt-1 font-numeric text-2xl tabular-nums text-foreground">{summary.cost_basis}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Unrealized P/L</dt>
              <dd className="mt-1 font-numeric text-2xl tabular-nums text-foreground">{summary.unrealized_pnl}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-base text-muted-foreground">
            Portfolio summary will appear here once the backend endpoint is available.
          </p>
        )}
      </div>
    </PageTemplate>
  );
}
