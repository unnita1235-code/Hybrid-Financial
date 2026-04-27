"use client";

import { useCallback, useRef, useState } from "react";
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
  const abortRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-zinc-950 text-slate-50">
      <div className="flex min-h-0 flex-1">
        <SavedReportsSidebar onSelect={onSaved} />
        <div className="flex min-w-0 flex-1 flex-col">
          <CommandBar onRun={runStream} isBusy={busy} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {query && (
              <div className="mb-3 space-y-1 font-mono text-[10px] text-slate-500">
                <p>
                  <span className="text-slate-600">Q</span> {query}
                </p>
                {lastWhatIf && (
                  <p className="text-amber-200/70">
                    <span className="text-amber-500/60">What-if</span> {lastWhatIf}
                  </p>
                )}
              </div>
            )}

            {/* Phase 1: SQL + chart — appears first when `sql` event lands */}
            <div
              className={cn(
                "grid gap-4",
                "lg:grid-cols-2",
                !sqlPayload && "opacity-40",
              )}
            >
              <div className="space-y-3">
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
                        ? "border-2 border-dashed border-amber-400/70"
                        : undefined
                    }
                  />
                ) : (
                  <div className="glass-terminal rounded-md border border-dashed border-white/10 p-4 text-sm text-slate-600">
                    SQL metric appears here as soon as the first stream event returns.
                  </div>
                )}
                {sqlPayload && (
                  <div
                    className={cn(
                      "glass-terminal rounded-md p-3",
                      simChrome && "border-2 border-dashed border-amber-400/70",
                    )}
                  >
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                      {simChrome ? "Read query (synthetic state)" : "SQL (read-only)"}
                    </p>
                    <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px] leading-tight text-slate-500">
                      {sqlPayload.sql}
                    </pre>
                    {simulationMeta && (
                      <div className="mt-2 border-t border-amber-500/20 pt-2">
                        <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-amber-500/70">
                          Rollback UPDATE
                        </p>
                        <pre className="mt-1 max-h-20 overflow-auto font-mono text-[10px] leading-tight text-amber-200/50">
                          {simulationMeta.updateSql}
                        </pre>
                      </div>
                    )}
                    <p className="mt-2 text-[10px] text-slate-600">
                      Rows: {sqlPayload.rows.length} · narrative + sparkline in the side
                      panel
                    </p>
                  </div>
                )}
              </div>
              {sqlPayload ? (
                <div
                  className={cn(
                    "glass-terminal flex min-h-[120px] flex-col justify-end gap-2 p-3",
                    simChrome && "border-2 border-dashed border-amber-400/70",
                  )}
                >
                  <p className="text-[9px] font-mono font-normal uppercase tracking-widest text-slate-500">
                    Series spark
                  </p>
                  <div className="flex min-h-0 items-end">
                    <InlineSparkline
                      data={sqlPayload.chart}
                      width={280}
                      height={32}
                      strokeClassName={
                        simChrome ? "stroke-amber-400/80" : "stroke-cyan-400/50"
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="min-h-[120px] rounded-md border border-dashed border-white/10 p-3 text-xs text-slate-600">
                  Minimap spark (no grid) appears when SQL loads.
                </div>
              )}
            </div>
            {sqlPayload && (
              <div
                className={cn(
                  "glass-terminal mt-4 overflow-hidden",
                  simChrome && "border-2 border-dashed border-amber-400/70",
                )}
              >
                <p className="border-b border-white/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Result rows
                </p>
                <div className="overflow-x-auto p-2">
                  <table className="w-full min-w-[280px] border-collapse text-[10px] text-slate-400">
                    <tbody>
                      {sqlPayload.rows.map((row, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          {Object.entries(row).map(([k, cell]) => (
                            <td key={k} className="px-2 py-1 align-top">
                              <span className="font-sans text-slate-600">{k}</span>{" "}
                              <span className="font-numeric text-slate-200">
                                {String(cell)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Inline hint: narrative is panel-first */}
            {sqlPayload && !narrative && !narrativeStreaming && !busy && (
              <p className="mt-4 text-center text-xs text-slate-600">
                Open the panel from the metric card, or it opens automatically when the
                run completes.
              </p>
            )}
          </div>
        </div>
      </div>

      <AgentTerminal lines={terminalLines} />

      <ContextPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Narrative context (RAG)"
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
                    : ["RAG chunks appear here when Supabase vector is configured."],
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
