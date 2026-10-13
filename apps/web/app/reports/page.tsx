"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Database,
  FileDown,
  FileText,
  ListChecks,
  Loader2,
  Newspaper,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { type MemoReportResponse, generateMemo } from "@/lib/memo-reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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

function safeText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function nonEmptyStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? v.trim() : safeText(v).trim()))
    .filter((s) => s.length > 0 && s !== "—");
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

  const headlines = result ? nonEmptyStrings(result.news_headlines) : [];
  const counterArguments = result
    ? nonEmptyStrings(result.counter_arguments)
    : [];
  const riskFactors = result ? nonEmptyStrings(result.risk_factors) : [];
  const hasDraft =
    result != null &&
    typeof result.draft === "string" &&
    result.draft.trim().length > 0;
  const hasSqlContext =
    result != null &&
    typeof result.sql_context === "string" &&
    result.sql_context.trim().length > 0;
  const hasSqlSummary =
    result != null &&
    typeof result.sql_summary === "string" &&
    result.sql_summary.trim().length > 0;
  const hasRagHint =
    result != null &&
    typeof result.rag_narrative_hint === "string" &&
    result.rag_narrative_hint.trim().length > 0;
  const hasModelSynthesis =
    result != null &&
    typeof result.model_synthesis === "string" &&
    result.model_synthesis.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl overflow-x-clip px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Dashboard
          </Link>
          <Link
            href="/debate"
            className="font-mono text-xs text-muted-foreground transition hover:text-foreground"
          >
            Debate
          </Link>
        </div>
        <Badge variant="default">Reports</Badge>
      </div>

      <div className="mb-4">
        <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
          Reports
        </h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Configure a date range and metric focus, generate a hybrid SQL + RAG
          analyst memo, inspect the returned content, and export the existing
          PDF.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="reports-start"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              Start
            </label>
            <input
              id="reports-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="reports-end"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              End
            </label>
            <input
              id="reports-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm tabular-nums text-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="reports-metric"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          >
            Metric focus
          </label>
          <select
            id="reports-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
          >
            {METRIC_PRESETS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={customMetric}
            onChange={(e) => setCustomMetric(e.target.value)}
            placeholder="Override with custom focus (optional)"
            aria-label="Custom metric focus"
            className="mt-1 w-full rounded-md border border-dashed border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
          />
        </div>

        {err && (
          <p className="text-xs text-destructive" role="alert">
            {err}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void onGenerate()}
            disabled={busy}
            className="min-h-[44px]"
          >
            {busy ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? "Drafting…" : "Generate memo"}
          </Button>
          {result && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onDownloadPdf()}
              className="min-h-[44px]"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              Download PDF
            </Button>
          )}
        </div>
      </Card>

      {!result && !busy && !err && (
        <Card className="mt-4 p-4">
          <div className="flex items-start gap-3">
            <FileText
              className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                No memo yet
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a date range and metric focus, then generate a memo. The
                returned content and its supporting sections will appear here.
              </p>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Final memo
              </h2>
              <Badge variant={result.used_llm ? "verified" : "default"}>
                LLM {result.used_llm ? "on" : "off"}
              </Badge>
              <Badge variant={result.used_news_api ? "verified" : "default"}>
                News {result.used_news_api ? "live" : "stub"}
              </Badge>
            </div>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {result.metric_focus} · {result.start_date} → {result.end_date}
            </p>
            <div className="mt-2 max-h-[min(70vh,36rem)] overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                {result.final_memo}
              </p>
            </div>
          </Card>

          {hasDraft && (
            <Card className="p-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Draft
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The pre-final draft returned alongside the memo above.
              </p>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {result.draft}
                </p>
              </div>
            </Card>
          )}

          {(hasSqlContext || hasSqlSummary) && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Database className="h-3.5 w-3.5" aria-hidden />
                SQL evidence
              </h2>
              {hasSqlSummary && (
                <p className="mt-2 break-words text-sm leading-6 text-foreground">
                  {result.sql_summary}
                </p>
              )}
              {hasSqlContext && (
                <details className="mt-2 rounded-md border border-border bg-muted/30">
                  <summary className="cursor-pointer px-3 py-2 font-mono text-xs text-muted-foreground transition hover:text-foreground">
                    SQL context
                  </summary>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-border p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {result.sql_context}
                  </pre>
                </details>
              )}
            </Card>
          )}

          {hasRagHint && (
            <Card className="p-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                RAG narrative hint
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Supporting retrieval context — not the final answer.
              </p>
              <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                {result.rag_narrative_hint}
              </p>
            </Card>
          )}

          {headlines.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Newspaper className="h-3.5 w-3.5" aria-hidden />
                News headlines
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground">
                {headlines.map((h, i) => (
                  <li key={`${i}-${h.slice(0, 32)}`} className="break-words">
                    {h}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {counterArguments.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
                Counterarguments
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground">
                {counterArguments.map((c, i) => (
                  <li key={`${i}-${c.slice(0, 32)}`} className="break-words">
                    {c}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {riskFactors.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <TriangleAlert
                  className="h-3.5 w-3.5 text-warning"
                  aria-hidden
                />
                Risk factors
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground">
                {riskFactors.map((r, i) => (
                  <li key={`${i}-${r.slice(0, 32)}`} className="break-words">
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {hasModelSynthesis && (
            <p className="break-words px-1 font-mono text-[11px] leading-5 text-muted-foreground">
              Model synthesis: {result.model_synthesis}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
