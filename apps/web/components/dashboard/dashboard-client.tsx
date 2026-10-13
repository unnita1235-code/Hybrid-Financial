"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { CommandBar, type CommandRunOptions } from "@/components/dashboard/command-bar";
import {
  AgentTerminal,
  type AgentTerminalLine,
} from "@/components/dashboard/agent-terminal";
import { ContextPanel } from "@/components/dashboard/context-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { InlineSparkline } from "@/components/dashboard/inline-sparkline";
import { ReasoningSheet } from "@/components/dashboard/reasoning-sheet";
import { SavedReportsSidebar } from "@/components/dashboard/saved-reports-sidebar";
import {
  type AgentWsServerMessage,
  getOrCreateTemporalThreadId,
  mapTemporalResultToSqlPayload,
} from "@/lib/agent-ws";
import {
  type SqlStreamPayload,
  type StreamEvent,
  type TransparencyPayload,
  formatMetricValue,
  readInsightSse,
} from "@/lib/insight-stream";
import { getBackendWsUrl } from "@/lib/aequitas-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function DashboardClient() {
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sqlPayload, setSqlPayload] = useState<SqlStreamPayload | null>(null);
  const [narrative, setNarrative] = useState("");
  const [narrativeStreaming, setNarrativeStreaming] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [transparency, setTransparency] = useState<TransparencyPayload | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [dataSource, setDataSource] = useState<"reality" | "simulation">("reality");
  const [lastWhatIf, setLastWhatIf] = useState<string | null>(null);
  const [simulationMeta, setSimulationMeta] = useState<{
    updateSql: string;
    rationale: string;
  } | null>(null);
  const [terminalLines, setTerminalLines] = useState<AgentTerminalLine[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);

  const simChrome = dataSource === "simulation" && !!sqlPayload;

  const runStream = useCallback(
    async (
      q: string,
      options: CommandRunOptions = { simulation: false, agentMode: "hybrid" },
    ) => {
      setQuery(q);
      setBusy(true);
      setSqlPayload(null);
      setNarrative("");
      setNarrativeStreaming(false);
      setTransparency(null);
      setAuditId(null);
      setPanelOpen(false);
      setSimulationMeta(null);
      setLastWhatIf(null);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        if (options.simulation) {
          if (!options.whatIf?.trim()) {
            setNarrative(
              "Add a what-if scenario to run a simulation, or turn off Simulation.",
            );
            return;
          }
          setLastWhatIf(options.whatIf);
          const res = await fetch("/api/simulation/scenario", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              what_if: options.whatIf,
              insight_query: q,
            }),
            signal: ac.signal,
          });
          const raw = (await res.json()) as
            | {
                value: number;
                label: string;
                format: SqlStreamPayload["format"];
                sql: string;
                rows: SqlStreamPayload["rows"];
                chart: SqlStreamPayload["chart"];
                update_sql: string;
                update_rationale: string;
                error?: string;
              }
            | { error: string };
          if (!res.ok) {
            const msg =
              "error" in raw && raw.error
                ? raw.error
                : `Simulation failed (${res.status})`;
            throw new Error(msg);
          }
          if ("error" in raw && raw.error) {
            throw new Error(String(raw.error));
          }
          if (!("value" in raw) || !("sql" in raw)) {
            throw new Error("Invalid simulation response");
          }
          setDataSource("simulation");
          setSqlPayload({
            value: raw.value,
            label: raw.label,
            format: raw.format,
            sql: raw.sql,
            rows: raw.rows,
            chart: raw.chart,
          });
          setSimulationMeta({
            updateSql: raw.update_sql,
            rationale: raw.update_rationale,
          });
          setNarrative(
            `Simulation — numbers reflect an uncommitted what-if; the database was rolled back. ${raw.update_rationale}`,
          );
          setPanelOpen(true);
          return;
        }

        setDataSource("reality");
        setTerminalLines([]);

        if (options.agentMode === "hybrid") {
          setNarrativeStreaming(true);
          try {
            const res = await fetch("/api/insight/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: q }),
              signal: ac.signal,
            });
            if (!res.ok) {
              const t = await res.text();
              setNarrative(`[Error] ${t.slice(0, 500)}`);
              return;
            }
            await readInsightSse(res.body, (ev: StreamEvent) => {
              if (ev.type === "transparency") {
                setTransparency(ev.data);
                if (ev.data.auditId) setAuditId(ev.data.auditId);
                return;
              }
              if (ev.type === "sql") {
                setSqlPayload(ev.data);
                setPanelOpen(true);
                return;
              }
              if (ev.type === "narrative") {
                setNarrative((n) => n + ev.delta);
                return;
              }
              if (ev.type === "error") {
                setNarrative((n) => n + (n ? " " : "") + ev.message);
                return;
              }
              if (ev.type === "done") {
                if (ev.auditId) setAuditId(ev.auditId);
                setPanelOpen(true);
              }
            });
          } finally {
            setNarrativeStreaming(false);
          }
          return;
        }

        const url = `${getBackendWsUrl()}/v1/temporal/ws`;
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const ws = new WebSocket(url);
          wsRef.current = ws;
          const onAbort = () => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          };
          ac.signal.addEventListener("abort", onAbort);
          const appendLog = (text: string, kind: "log" | "error" = "log") => {
            const id =
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`;
            const stamp = new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
            setTerminalLines((prev) => [
              ...prev,
              { id, text: `[${stamp}] ${text}`, kind },
            ]);
          };
          ws.onopen = () => {
            const threadId = getOrCreateTemporalThreadId();
            if (!threadId) {
              appendLog("Could not get thread_id (not in browser).", "error");
              finish();
              return;
            }
            ws.send(
              JSON.stringify({
                type: "run",
                thread_id: threadId,
                user_query: q,
              }),
            );
          };
          ws.onmessage = (ev) => {
            let msg: AgentWsServerMessage;
            try {
              msg = JSON.parse(String(ev.data)) as AgentWsServerMessage;
            } catch {
              appendLog("Invalid JSON from server", "error");
              return;
            }
            if (msg.type === "log") {
              appendLog(`${msg.message} (${msg.node})`);
              return;
            }
            if (msg.type === "error") {
              appendLog(msg.message, "error");
              setNarrative(`[Error] ${msg.message}`);
              setNarrativeStreaming(false);
              finish();
              return;
            }
            if (msg.type === "result") {
              if (msg.data.warning) {
                appendLog(`Note: ${String(msg.data.warning)}`, "error");
              }
              setSqlPayload(mapTemporalResultToSqlPayload(msg.data));
              setNarrative(msg.data.narrative);
              setNarrativeStreaming(false);
              setPanelOpen(true);
              setTransparency(null);
              setAuditId(null);
              finish();
              return;
            }
          };
          ws.onerror = () => {
            appendLog("WebSocket connection error (is the API running?)", "error");
            setNarrative(
              (p) => p + (p ? " " : "") + "[WebSocket error: check API server]",
            );
            setNarrativeStreaming(false);
          };
          ws.onclose = () => {
            ac.signal.removeEventListener("abort", onAbort);
            finish();
          };
        });
        wsRef.current = null;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setNarrative(
          (p) => p + ` Error: ${e instanceof Error ? e.message : "unknown"}`,
        );
        setNarrativeStreaming(false);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const onSaved = useCallback(
    (id: string) => {
      const preset =
        id === "1"
          ? "Show TTM revenue from transactions."
          : id === "2"
            ? "Correlate flow with an index time series when possible."
            : "Summarize risk language from 10-K filings for our universe.";
      void runStream(preset, { simulation: false, agentMode: "hybrid" });
    },
    [runStream],
  );

  const onFeedback = useCallback(
    async (vote: 1 | -1, correction?: string) => {
      if (!auditId) return;
      const r = await fetch("/api/audit/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audit_log_id: auditId,
          vote,
          correction_text: correction ?? null,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || "Feedback failed");
      }
    },
    [auditId],
  );

  const isError = /\[Error\]|Error:/.test(narrative);
  const status: "Ready" | "Running" | "Streaming" | "Partial" | "Completed" | "No results" | "Error" =
    !query
      ? "Ready"
      : isError
        ? "Error"
        : busy && !sqlPayload && !narrative
          ? "Running"
          : narrativeStreaming || (busy && (!!sqlPayload || !!narrative))
            ? "Streaming"
            : sqlPayload && narrative
              ? "Completed"
              : sqlPayload
                ? "Partial"
                : !busy
                  ? "No results"
                  : "Ready";
  const statusVariant =
    status === "Completed"
      ? "verified"
      : status === "Running" || status === "Streaming" || status === "Partial"
        ? "primary"
        : status === "Error"
          ? "failed"
          : status === "No results"
            ? "throttled"
            : "default";

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-x-clip bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <div className="hidden shrink-0 lg:flex lg:w-[280px]">
          <SavedReportsSidebar onSelect={onSaved} className="w-[280px]" />
        </div>
        {railOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
              aria-hidden
              onClick={() => setRailOpen(false)}
            />
            <div
              className="fixed left-0 top-0 z-50 flex h-full w-full max-w-[320px] flex-col border-r border-border bg-card lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Saved queries"
            >
              <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Saved queries
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setRailOpen(false)}
                  aria-label="Close saved queries"
                  className="px-2.5"
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                </Button>
              </div>
              <SavedReportsSidebar
                onSelect={(id) => {
                  onSaved(id);
                  setRailOpen(false);
                }}
                className="w-full flex-1 border-r-0"
              />
            </div>
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border/30 bg-card px-4 py-2 lg:hidden">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRailOpen(true)}
              aria-label="Open saved queries"
              aria-expanded={railOpen}
              className="px-2.5"
            >
              <Menu className="h-4 w-4" strokeWidth={2} aria-hidden />
              Queries
            </Button>
            <Badge variant={statusVariant} aria-live="polite">
              {status}
            </Badge>
            {simChrome && (
              <Badge variant="throttled">Simulation</Badge>
            )}
          </div>
          <CommandBar onRun={runStream} isBusy={busy} />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip p-4">
            <div className="mx-auto w-full max-w-5xl">
            <div className="mb-4 hidden items-center gap-2 lg:flex" aria-live="polite">
              <Badge variant={statusVariant}>{status}</Badge>
              {simChrome ? (
                <Badge variant="throttled">Simulation — rolled back</Badge>
              ) : null}
              {narrativeStreaming ? (
                <span className="text-xs text-muted-foreground">Streaming response…</span>
              ) : null}
            </div>
            {query && (
              <div className="mb-4 space-y-1.5 font-sans text-xs text-muted-foreground">
                <p className="break-words">
                  <span className="text-muted-foreground/60">Q</span> {query}
                </p>
                {lastWhatIf && (
                  <p className="break-words text-warning/80">
                    <span className="text-warning/60">What-if</span> {lastWhatIf}
                  </p>
                )}
              </div>
            )}

            {/* SQL + chart — appears first when `sql` event lands */}
            <div
              className={cn(
                "grid gap-4",
                "md:grid-cols-2",
                !sqlPayload && "opacity-60",
              )}
            >
              <div className="min-w-0 space-y-3">
                {sqlPayload ? (
                  <MetricCard
                    label={sqlPayload.label}
                    value={formatMetricValue(sqlPayload.value, sqlPayload.format)}
                    sublabel={
                      simChrome
                        ? "Synthetic snapshot (rolled back — not live data)"
                        : "From live SQL (read path)"
                    }
                    isLive
                    onOpenContext={() => setPanelOpen(true)}
                    className={
                      simChrome
                        ? "border-2 border-dashed border-warning/50"
                        : undefined
                    }
                  />
                ) : (
                  <Card className="border-dashed p-4">
                    <p className="text-sm font-medium text-foreground">Ready — ask a question to begin</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      SQL metric appears here as soon as the first stream event returns. No mock figures are shown.
                    </p>
                  </Card>
                )}
                {sqlPayload && (
                  <Card
                    className={cn(
                      "p-3",
                      simChrome && "border-2 border-dashed border-warning/50",
                    )}
                  >
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {simChrome ? "Read query (synthetic state)" : "SQL (read-only)"}
                    </p>
                    <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px] leading-tight text-muted-foreground">
                      {sqlPayload.sql}
                    </pre>
                    {simulationMeta && (
                      <div className="mt-2 border-t border-warning/20 pt-2">
                        <p className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-warning">
                          Rollback UPDATE
                        </p>
                        <pre className="mt-1 max-h-20 overflow-auto font-mono text-[10px] leading-tight text-warning/80">
                          {simulationMeta.updateSql}
                        </pre>
                      </div>
                    )}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Rows: {sqlPayload.rows.length} · narrative + sparkline in the side
                      panel
                    </p>
                  </Card>
                )}
              </div>
              {sqlPayload ? (
                <Card
                  className={cn(
                    "flex min-h-[120px] min-w-0 flex-col justify-end gap-3 p-4",
                    simChrome && "border-2 border-dashed border-warning/50",
                  )}
                >
                  <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Series spark
                  </p>
                  <div className="flex min-h-0 min-w-0 items-end">
                    <InlineSparkline
                      data={sqlPayload.chart}
                      width={280}
                      height={32}
                      strokeClassName={
                        simChrome ? "stroke-warning/60" : "stroke-primary/50"
                      }
                    />
                  </div>
                </Card>
              ) : (
                <Card className="min-h-[120px] border-dashed p-4">
                  <p className="text-sm font-medium text-foreground">No series yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Minimap spark (no grid) appears when SQL loads.
                  </p>
                </Card>
              )}
            </div>
            {isError && (
              <Card className="mt-4 border-destructive/40 p-4" role="alert">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="failed">Error</Badge>
                  <p className="text-xs text-muted-foreground">
                    Query preserved — review the message in the evidence panel, then press Run to retry.
                  </p>
                </div>
              </Card>
            )}
            {sqlPayload && (
              <Card
                className={cn(
                  "mt-4 min-w-0 overflow-hidden",
                  simChrome && "border-2 border-dashed border-warning/50",
                )}
              >
                <p className="border-b border-border/30 px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Result rows
                </p>
                <div className="overflow-x-auto p-3">
                  <table className="w-full min-w-[280px] border-collapse text-xs text-muted-foreground">
                    <tbody>
                      {sqlPayload.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/20 last:border-0">
                          {Object.entries(row).map(([k, cell]) => (
                            <td key={k} className="px-3 py-2 align-top">
                              <span className="font-sans text-muted-foreground/60">{k}</span>{" "}
                              <span className="font-numeric font-medium tabular-nums text-foreground">
                                {String(cell)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            {!query && !sqlPayload && (
              <Card className="mt-4 border-dashed p-4">
                <p className="text-sm font-medium text-foreground">Empty state — no run yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use Hybrid insight for SQL + RAG synthesis, Compare for two-period deltas, or open saved example presets. Evidence, SQL, and provenance appear here and in the right panel.
                </p>
              </Card>
            )}
            {query && !busy && !sqlPayload && !isError && (
              <Card className="mt-4 border-dashed p-4" role="status">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="throttled">No results</Badge>
                  <p className="text-xs text-muted-foreground">
                    Last run ended without SQL rows — query preserved. Adjust the question and press Run.
                  </p>
                </div>
              </Card>
            )}

            {/* Inline hint: narrative is panel-first */}
            {sqlPayload && !narrative && !narrativeStreaming && !busy && !isError && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Open the panel from the metric card, or it opens automatically when the
                run completes.
              </p>
            )}
            </div>
          </div>
        </div>
      </div>

      <AgentTerminal lines={terminalLines} />

      <ContextPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Evidence & provenance"
        narrative={narrative}
        isStreaming={narrativeStreaming}
        transparency={transparency}
        auditId={auditId}
        onFeedback={onFeedback}
        sql={sqlPayload?.sql ?? ""}
        chartData={sqlPayload?.chart ?? null}
        onOpenReasoning={() => setReasoningOpen(true)}
        sources={
          sqlPayload
            ? {
                sql: sqlPayload.sql,
                documentHints:
                  (transparency?.ragChunks?.length ?? 0) > 0
                    ? (transparency?.ragChunks ?? []).map(
                        (c) => c.content_preview || c.source,
                      )
                    : ["RAG chunks appear here once retrieval returns passages."],
              }
            : undefined
        }
      />
      <ReasoningSheet
        open={reasoningOpen}
        onOpenChange={setReasoningOpen}
        sqlOkMs={2}
        ragChunks={transparency?.ragChunks?.length ?? 0}
        modelLabel="hybrid_synthesis_rag_v1"
      />
    </div>
  );
}
