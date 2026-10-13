"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Database,
  FileText,
  Info,
  Loader2,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { type DebateRiskResponse, generateDebateRiskAssessment } from "@/lib/debate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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

function cellText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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

  const previewRows = result?.sql_rows_preview ?? [];
  const previewColumns = Array.from(
    new Set(previewRows.flatMap((row) => Object.keys(row ?? {}))),
  ).slice(0, 12);
  const previewColumnsTruncated =
    new Set(previewRows.flatMap((row) => Object.keys(row ?? {}))).size >
    previewColumns.length;

  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-clip px-4 py-6">
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
            href="/reports"
            className="font-mono text-xs text-muted-foreground transition hover:text-foreground"
          >
            Reports
          </Link>
        </div>
        <Badge variant="default">Debate</Badge>
      </div>

      <div className="mb-4">
        <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
          Risk debate
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Bull and Bear run in parallel on the same RAG + SQL evidence, then a
          Judge assigns the final conviction score.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="space-y-1.5">
          <label
            htmlFor="debate-metric"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          >
            Metric
          </label>
          <select
            id="debate-metric"
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
            placeholder="Override with custom metric (optional)"
            aria-label="Custom metric"
            className="mt-1 w-full rounded-md border border-dashed border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
          />
        </div>

        {err && (
          <p className="text-xs text-destructive" role="alert">
            {err}
          </p>
        )}

        <Button
          type="button"
          onClick={() => void onRun()}
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
          {busy ? "Debating..." : "Run risk debate"}
        </Button>
      </Card>

      {result && (
        <div className="mt-6 space-y-4">
          <section aria-label="Derived indicators">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Derived indicators
              </h2>
              <Badge variant="default">
                <Info className="h-3 w-3" aria-hidden />
                Calculated in the browser
              </Badge>
            </div>
            <p className="mb-2 max-w-3xl text-xs text-muted-foreground">
              These three figures are computed by the frontend from the current
              response (evidence weights and argument lengths). They are not
              model outputs.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Argument quality
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {qualityScore}
                  <span className="text-sm font-normal text-muted-foreground">
                    /100
                  </span>
                </p>
              </Card>
              <Card className="p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Evidence density
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {evidenceDensity}
                  <span className="text-sm font-normal text-muted-foreground">
                    %
                  </span>
                </p>
              </Card>
              <Card className="p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Consistency score
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {consistencyScore}
                  <span className="text-sm font-normal text-muted-foreground">
                    %
                  </span>
                </p>
              </Card>
            </div>
          </section>

          <Card className="p-4" aria-label="Conviction">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Scale className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Conviction score
              </h2>
              <Badge variant="primary">Returned model value</Badge>
            </div>
            <div
              className="relative h-2 rounded-full border border-border bg-muted"
              role="meter"
              aria-valuemin={-1}
              aria-valuemax={1}
              aria-valuenow={Number(result.conviction.toFixed(3))}
              aria-label={`Returned conviction ${result.conviction.toFixed(3)} on a Bear minus one to Bull plus one axis`}
            >
              <div
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-card"
                style={{ left: `calc(${scorePct}% - 8px)` }}
                aria-hidden
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Bear (&minus;1)</span>
              <span className="font-mono tabular-nums text-foreground">
                {result.conviction.toFixed(3)}
              </span>
              <span>Bull (+1)</span>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Judge synthesis
            </h2>
            <p className="mt-2 break-words text-sm leading-6 text-foreground">
              {result.judge_synthesis}
            </p>
            {result.warning && (
              <div
                className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
                role="alert"
              >
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span className="break-words">{result.warning}</span>
              </div>
            )}
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Judge rationale criteria
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Evidence coverage across SQL and RAG signals.</li>
                <li>Internal consistency between claim and cited support.</li>
                <li>Practical actionability for portfolio risk decisions.</li>
              </ul>
            </div>
          </Card>

          <section
            aria-label="Bull and Bear arguments"
            className="grid min-w-0 gap-4 lg:grid-cols-2"
          >
            <Card className="min-w-0 border-t-2 border-t-success p-4">
              <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <TrendingUp
                  className="h-3.5 w-3.5 text-success"
                  aria-hidden
                />
                Bull argument
              </h2>
              <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
                  {result.bull_argument}
                </pre>
              </div>
            </Card>

            <Card className="min-w-0 border-t-2 border-t-destructive p-4">
              <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <TrendingDown
                  className="h-3.5 w-3.5 text-destructive"
                  aria-hidden
                />
                Bear argument
              </h2>
              <div className="max-h-[min(62vh,30rem)] overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
                  {result.bear_argument}
                </pre>
              </div>
            </Card>
          </section>

          <Card className="p-4" aria-label="Retrieved evidence and technical details">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Retrieved evidence
              </h2>
              <Badge variant={result.used_sql ? "verified" : "default"}>
                <Database className="h-3 w-3" aria-hidden />
                SQL {result.used_sql ? "used" : "not used"}
              </Badge>
              <Badge variant={result.used_rag ? "verified" : "default"}>
                <FileText className="h-3 w-3" aria-hidden />
                RAG {result.used_rag ? "used" : "not used"}
              </Badge>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <p className="text-xs text-muted-foreground">
                Evidence Bull:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {result.e_bull}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Evidence Bear:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {result.e_bear}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Weight w1:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {result.w1}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Weight w2:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {result.w2}
                </span>
              </p>
            </div>

            {result.sql != null && result.sql !== "" ? (
              <details className="mt-3 rounded-md border border-border bg-muted/30">
                <summary className="cursor-pointer px-3 py-2 font-mono text-xs text-muted-foreground transition hover:text-foreground">
                  Executed SQL
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-border p-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {result.sql}
                </pre>
              </details>
            ) : (
              <p className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                No SQL was returned with this response.
              </p>
            )}

            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                SQL rows preview
              </p>
              {previewRows.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No SQL rows were returned with this response.
                </p>
              ) : previewColumns.length === 0 ? (
                <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(previewRows, null, 2)}
                </pre>
              ) : (
                <div className="mt-1 max-h-64 overflow-auto rounded-md border border-border">
                  <table className="w-full border-collapse font-mono text-[11px]">
                    <caption className="sr-only">
                      Preview of rows returned by the executed SQL query
                    </caption>
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        {previewColumns.map((col) => (
                          <th
                            key={col}
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-border/50 last:border-0"
                        >
                          {previewColumns.map((col) => (
                            <td
                              key={col}
                              className="max-w-64 break-words px-2 py-1.5 align-top tabular-nums text-foreground"
                            >
                              {cellText((row ?? {})[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewColumnsTruncated && (
                    <p className="border-t border-border p-2 text-[11px] text-muted-foreground">
                      Showing the first {previewColumns.length} columns; the
                      response contains additional fields.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                RAG sources
              </p>
              {result.rag_sources.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No RAG sources were returned with this response.
                </p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {result.rag_sources.map((src, i) => (
                    <li
                      key={`${src.source}-${i}`}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <p className="break-words font-mono text-[11px] font-medium text-secondary">
                        {src.source}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                        {src.snippet}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
