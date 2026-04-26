"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Scale, Sparkles } from "lucide-react";
import { type DebateRiskResponse, generateDebateRiskAssessment } from "@/lib/debate";
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

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-100">
      <div className="border-b border-white/10 glass-terminal">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="inline-flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400 transition hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Dashboard
            </Link>
            <Link
              href="/reports"
              className="font-mono text-xs text-slate-500 transition hover:text-slate-300"
            >
              Reports
            </Link>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Debate
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <header>
          <h1 className="font-mono text-lg font-medium tracking-tight text-slate-100">
            Risk debate system
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Bull and Bear run in parallel on the same RAG + SQL evidence, then a Judge
            assigns the final conviction score.
          </p>
        </header>

        <div className="glass-terminal space-y-4 rounded-lg border border-white/10 p-4">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Metric
            </span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500/40"
            >
              {METRIC_PRESETS.map((m) => (
                <option key={m} value={m} className="bg-zinc-900">
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={customMetric}
              onChange={(e) => setCustomMetric(e.target.value)}
              placeholder="Override with custom metric (optional)"
              className="mt-1 w-full rounded border border-dashed border-white/15 bg-transparent px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-slate-500/40"
            />
          </label>

          {err && <p className="font-mono text-xs text-rose-300/90">{err}</p>}

          <button
            type="button"
            onClick={() => void onRun()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white px-4 py-2.5 text-xs font-medium text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {busy ? "Debating..." : "Run risk debate"}
          </button>
        </div>

        {result && (
          <>
            <section className="glass-terminal rounded-lg border border-white/10 p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <Scale className="h-3.5 w-3.5" strokeWidth={1.5} />
                Conviction score
              </div>
              <div className="space-y-2">
                <div className="relative h-2 rounded-full bg-zinc-700">
                  <div
                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-zinc-200 bg-zinc-900"
                    style={{ left: `calc(${scorePct}% - 8px)` }}
                    aria-hidden
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Bear (-1)</span>
                  <span className="font-mono text-slate-300">
                    {result.conviction.toFixed(3)}
                  </span>
                  <span>Bull (+1)</span>
                </div>
                <p className="text-sm text-slate-300">{result.judge_synthesis}</p>
                {result.warning && (
                  <p className="font-mono text-xs text-amber-300/90">
                    {result.warning}
                  </p>
                )}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="glass-terminal rounded-lg border border-white/10 p-4">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  Bull argument
                </p>
                <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded border border-white/5 bg-slate-950/40 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                    {result.bull_argument}
                  </pre>
                </div>
              </article>

              <article className="glass-terminal rounded-lg border border-white/10 p-4">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  Bear argument
                </p>
                <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded border border-white/5 bg-slate-950/40 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                    {result.bear_argument}
                  </pre>
                </div>
              </article>
            </section>

            <section
              className={cn(
                "glass-terminal rounded-lg border border-white/10 p-4 text-xs text-slate-400",
              )}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  Evidence Bull:{" "}
                  <span className="font-mono text-slate-300">{result.e_bull}</span>
                </p>
                <p>
                  Evidence Bear:{" "}
                  <span className="font-mono text-slate-300">{result.e_bear}</span>
                </p>
                <p>
                  Weight w1:{" "}
                  <span className="font-mono text-slate-300">{result.w1}</span>
                </p>
                <p>
                  Weight w2:{" "}
                  <span className="font-mono text-slate-300">{result.w2}</span>
                </p>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
