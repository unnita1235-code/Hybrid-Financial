"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, FileDown, Sparkles } from "lucide-react";
import { type MemoReportResponse, generateMemo } from "@/lib/memo-reports";
import { cn } from "@/lib/utils";

const METRIC_PRESETS = [
  "Q3 Revenue Leakage",
  "Gross margin bridge",
  "Working capital & DSO",
  "FX translation noise",
  "Segment mix vs. guide",
];

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  const m = Math.floor(start.getMonth() / 3) * 3;
  start.setMonth(m, 1);
  return { start: toIso(start), end: toIso(end) };
}

export default function ReportsPage() {
  const def = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [metric, setMetric] = useState(METRIC_PRESETS[0]);
  const [customMetric, setCustomMetric] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MemoReportResponse | null>(null);

  const effectiveMetric = customMetric.trim() || metric;

  const onGenerate = useCallback(async () => {
    if (!effectiveMetric) {
      setErr("Choose or enter a metric focus.");
      return;
    }
    if (startDate > endDate) {
      setErr("Start date must be on or before end date.");
      return;
    }
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const r = await generateMemo({
        start_date: startDate,
        end_date: endDate,
        metric_focus: effectiveMetric,
      });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [startDate, endDate, effectiveMetric]);

  const onDownloadPdf = useCallback(async () => {
    if (!result) return;
    const [{ pdf }, { MemoPdfDocument }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/components/reports/memo-pdf-document"),
    ]);
    const el = <MemoPdfDocument data={result} />;
    const blob = await pdf(el).toBlob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `aequitas-memo-${result.start_date}-${result.end_date}.pdf`;
    a.click();
    URL.revokeObjectURL(u);
  }, [result]);

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-100">
      <div className="border-b border-white/10 glass-terminal">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <div className="inline-flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400 transition hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Dashboard
            </Link>
            <Link
              href="/debate"
              className="font-mono text-xs text-slate-500 transition hover:text-slate-300"
            >
              Debate
            </Link>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Reports
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <header>
          <h1 className="font-mono text-lg font-medium tracking-tight text-slate-100">
            Hybrid memo
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            SQL window + RAG narrative, then a critic pass against live market
            headlines. Export a minimal PDF for distribution.
          </p>
        </header>

        <div className="glass-terminal space-y-4 rounded-lg border border-white/10 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded border border-white/10 bg-slate-900/50 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-slate-500/40"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                End
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded border border-white/10 bg-slate-900/50 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-slate-500/40"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Metric focus
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
              placeholder="Override with custom focus (optional)"
              className="mt-1 w-full rounded border border-dashed border-white/15 bg-transparent px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-slate-500/40"
            />
          </label>

          {err && <p className="font-mono text-xs text-rose-300/90">{err}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white px-4 py-2.5 text-xs font-medium text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              {busy ? "Drafting…" : "Generate memo"}
            </button>
            {result && (
              <button
                type="button"
                onClick={() => void onDownloadPdf()}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-slate-900/50 px-4 py-2.5 text-xs font-medium text-slate-100 transition hover:border-white/20"
              >
                <FileDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                Download PDF
              </button>
            )}
          </div>
        </div>

        {result && (
          <div
            className={cn(
              "glass-terminal space-y-3 rounded-lg border border-white/10 p-4",
            )}
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500">
              Output <span className="text-slate-600">·</span>{" "}
              <span
                className={cn(
                  result.used_llm ? "text-emerald-500/80" : "text-amber-500/80",
                )}
              >
                LLM {result.used_llm ? "on" : "off"}
              </span>
              <span className="text-slate-600"> · </span>
              <span
                className={cn(
                  result.used_news_api ? "text-emerald-500/80" : "text-amber-500/80",
                )}
              >
                News {result.used_news_api ? "API" : "stub"}
              </span>
            </p>
            <div className="max-h-[min(70vh,36rem)] overflow-y-auto rounded border border-white/5 bg-slate-950/40 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                {result.final_memo}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
