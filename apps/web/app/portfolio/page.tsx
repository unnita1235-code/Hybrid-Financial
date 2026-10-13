"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Briefcase, CloudOff, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PortfolioSummary = {
  positions: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
};

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return Math.trunc(value).toString();
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  // No currency is documented by the response contract, so values are shown
  // exactly as returned with grouping only.
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function PortfolioPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const loadSummary = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`Portfolio request failed (${res.status})`);
      const data = (await res.json()) as PortfolioSummary;
      if (mountedRef.current) setSummary(data);
    } catch (e) {
      if (mountedRef.current) {
        setSummary(null);
        setError(e instanceof Error ? e.message : "Failed to load portfolio");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadSummary();
    return () => {
      mountedRef.current = false;
    };
  }, [loadSummary]);

  const status: "Loading" | "Unavailable" | "Empty" | "Available" = loading
    ? "Loading"
    : error != null || summary == null
      ? "Unavailable"
      : summary.positions === 0
        ? "Empty"
        : "Available";

  return (
    <div className="mx-auto w-full max-w-5xl overflow-x-clip px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
            Portfolio Intelligence
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review portfolio positions, market value, cost basis, and unrealized profit
            and loss once the portfolio data service returns them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" aria-live="polite">
            <Briefcase className="h-3 w-3" aria-hidden />
            {status}
          </Badge>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadSummary()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5 motion-reduce:animate-none" aria-hidden />
            Retry
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="p-6 text-center">
          <p
            className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2
              className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden
            />
            Loading portfolio summary&hellip;
          </p>
        </Card>
      ) : status === "Unavailable" ? (
        <div className="space-y-4">
          {error && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          )}
          <Card className="p-6 text-center">
            <div className="mx-auto max-w-md">
              <CloudOff className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <h2 className="mt-2 text-base font-semibold text-foreground">
                Portfolio data unavailable
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The portfolio data service is not currently available in this
                application, so no positions can be shown. Once a supported connection
                exists, this page will show position counts, market value, cost basis,
                and unrealized profit and loss.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                This means the data could not be loaded — not that the portfolio is
                empty.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => void loadSummary()}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </Button>
            </div>
          </Card>
        </div>
      ) : status === "Empty" ? (
        <Card className="p-6 text-center">
          <div className="mx-auto max-w-md">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <h2 className="mt-2 text-base font-semibold text-foreground">
              No positions
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The portfolio service responded successfully and reports zero positions.
              Holdings will appear here when positions exist.
            </p>
          </div>
        </Card>
      ) : (
        summary && (
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Portfolio summary
              </h2>
              <Badge variant="verified">Live response</Badge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Positions
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatCount(summary.positions)}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Market value
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatAmount(summary.market_value)}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Cost basis
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatAmount(summary.cost_basis)}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Unrealized P/L
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatAmount(summary.unrealized_pnl)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Values are shown exactly as returned by the portfolio service; no currency
              is assumed. Detailed holdings, allocations, and risk analytics are not
              part of the current response.
            </p>
          </Card>
        )
      )}
    </div>
  );
}
