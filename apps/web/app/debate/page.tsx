"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Scale, Sparkles } from "lucide-react";
import { type DebateRiskResponse, generateDebateRiskAssessment } from "@/lib/debate";
import { PageTemplate } from "@/components/layout/page-template";
import { cn } from "@/lib/utils";

const METRIC_PRESETS = [
  "Debt-to-equity ratio",
  "Net leverage trajectory",
  "Interest coverage durability",
  "Gross margin resilience",
  "Working capital stress",
];

function convictionPercent(conviction: number): number {
  const clamped = Math.max(-1, Math.min(1, conviction));
  return Math.round(((clamped + 1) / 2) * 100);
}

export default function DebatePage() {
  const [metric, setMetric] = useState(METRIC_PRESETS[0]);
  const [customMetric, setCustomMetric] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DebateRiskResponse | null>(null);

  const effectiveMetric = useMemo(
    () => (customMetric.trim() || metric).trim(),
    [customMetric, metric],
  );

  const onRun = useCallback(async () => {
    if (!effectiveMetric) {
      setErr("Choose or enter a metric.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await generateDebateRiskAssessment({ metric: effectiveMetric });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [effectiveMetric]);

  const scorePct = result ? convictionPercent(result.conviction) : 50;
  const qualityScore = result
    ? Math.round(
        ((result.e_bull + result.e_bear) / 2) * 50 +
          Math.min(
            50,
            (result.bull_argument.length + result.bear_argument.length) / 80,
          ),
      )
    : 0;
  const consistencyScore = result
    ? Math.round((1 - Math.abs(result.e_bull - result.e_bear)) * 100)
    : 0;
  const evidenceDensity = result
    ? Math.round(((result.e_bull + result.e_bear) / 2) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border glass-terminal">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="inline-flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Dashboard
            </Link>
            <Link
              href="/reports"
              className="font-mono text-xs text-muted-foreground transition hover:text-foreground"
            >
              Reports
            </Link>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Debate
          </span>
        </div>
      </div>

      <PageTemplate
        title="Risk debate system"
        subtitle="Bull and Bear run in parallel on the same RAG + SQL evidence, then a Judge assigns the final conviction score."
      >

        <div className="neon-card space-y-4 rounded-lg border p-4">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Metric
            </span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded border border-border bg-background/70 px-3 py-2 text-base text-foreground outline-none focus:border-primary/60"
            >
              {METRIC_PRESETS.map((m) => (
                <option key={m} value={m} className="bg-background">
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={customMetric}
              onChange={(e) => setCustomMetric(e.target.value)}
              placeholder="Override with custom metric (optional)"
              className="mt-1 w-full rounded border border-dashed border-border bg-transparent px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
            />
          </label>

          {err && <p className="font-mono text-xs text-rose-300/90">{err}</p>}

          <button
            type="button"
            onClick={() => void onRun()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 hover:shadow-[0_0_18px_hsl(var(--neon-cyan)/0.45)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {busy ? "Debating..." : "Run risk debate"}
          </button>
        </div>

        {result && (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="neon-card neon-hover rounded-lg border p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Argument quality
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {qualityScore}/100
                </p>
              </div>
              <div className="neon-card neon-hover rounded-lg border p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Evidence density
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {evidenceDensity}%
                </p>
              </div>
              <div className="neon-card neon-hover rounded-lg border p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Consistency score
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {consistencyScore}%
                </p>
              </div>
            </section>
            <section className="neon-card rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <Scale className="h-3.5 w-3.5" strokeWidth={1.5} />
                Conviction score
              </div>
              <div className="space-y-2">
                <div className="relative h-2 rounded-full bg-muted">
                  <div
                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-border bg-background"
                    style={{ left: `calc(${scorePct}% - 8px)` }}
                    aria-hidden
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Bear (-1)</span>
                  <span className="font-mono text-foreground/90">
                    {result.conviction.toFixed(3)}
                  </span>
                  <span>Bull (+1)</span>
                </div>
                <p className="text-base leading-6 text-foreground/90">{result.judge_synthesis}</p>
                {result.warning && (
                  <p className="font-mono text-xs text-amber-300/90">
                    {result.warning}
                  </p>
                )}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="neon-card neon-hover rounded-lg border p-4">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Bull argument
                </p>
                <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded border border-border bg-background/60 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85">
                    {result.bull_argument}
                  </pre>
                </div>
              </article>

              <article className="neon-card neon-hover rounded-lg border p-4">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Bear argument
                </p>
                <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded border border-border bg-background/60 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85">
                    {result.bear_argument}
                  </pre>
                </div>
              </article>
            </section>

            <section
              className={cn(
                "neon-card rounded-lg border p-4 text-xs text-muted-foreground",
              )}
            >
              <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Judge rationale criteria
              </p>
              <ul className="mb-3 list-disc space-y-1 pl-4 text-sm text-foreground/85">
                <li>Evidence coverage across SQL and RAG signals.</li>
                <li>Internal consistency between claim and cited support.</li>
                <li>Practical actionability for portfolio risk decisions.</li>
              </ul>
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  Evidence Bull:{" "}
                  <span className="font-mono text-foreground/90">{result.e_bull}</span>
                </p>
                <p>
                  Evidence Bear:{" "}
                  <span className="font-mono text-foreground/90">{result.e_bear}</span>
                </p>
                <p>
                  Weight w1:{" "}
                  <span className="font-mono text-foreground/90">{result.w1}</span>
                </p>
                <p>
                  Weight w2:{" "}
                  <span className="font-mono text-foreground/90">{result.w2}</span>
                </p>
              </div>
              <div className="mt-3 rounded border border-border bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Evidence trace snippets
                </p>
                <p className="mt-1 text-sm text-foreground/85">
                  Bull snippet: {(result.bull_argument || "").slice(0, 160)}...
                </p>
                <p className="mt-1 text-sm text-foreground/85">
                  Bear snippet: {(result.bear_argument || "").slice(0, 160)}...
                </p>
              </div>
            </section>
          </>
        )}
      </PageTemplate>
    </div>
  );
}
