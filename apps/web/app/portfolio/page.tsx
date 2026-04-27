"use client";

import { useEffect, useState } from "react";

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
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-100">Portfolio tracker</h1>
      <p className="mt-1 text-sm text-slate-500">
        Monitor positions and run portfolio-level analysis.
      </p>
      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="mt-4 glass-terminal rounded-xl p-4 text-sm text-slate-300">
        {summary ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Positions</dt>
              <dd>{summary.positions}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Market value</dt>
              <dd>{summary.market_value}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Cost basis</dt>
              <dd>{summary.cost_basis}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Unrealized P/L</dt>
              <dd>{summary.unrealized_pnl}</dd>
            </div>
          </dl>
        ) : (
          <p>
            Portfolio summary will appear here once the backend endpoint is available.
          </p>
        )}
      </div>
    </div>
  );
}
