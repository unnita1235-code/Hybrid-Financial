/**
 * WebSocket protocol for `ws://.../v1/temporal/ws` — server messages are JSON.
 */

import type { SqlStreamPayload } from "@/lib/insight-stream";

const TEMPORAL_THREAD_KEY = "aequitas.temporal_thread_id";

/** Stable conversation id for LangGraph checkpointing (localStorage). */
export function getOrCreateTemporalThreadId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  let t = localStorage.getItem(TEMPORAL_THREAD_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TEMPORAL_THREAD_KEY, t);
  }
  return t;
}

export type TemporalAgentResultPayload = {
  baseline: number | null;
  new: number | null;
  delta_percent: number | null;
  delta_absolute: number | null;
  label_baseline: string;
  label_new: string;
  narrative: string;
  warning?: string | null;
  sql_baseline?: string | null;
  sql_new?: string | null;
};

export type AgentWsServerMessage =
  | { type: "log"; message: string; node: string }
  | { type: "result"; data: TemporalAgentResultPayload }
  | { type: "error"; message: string };

export function mapTemporalResultToSqlPayload(
  data: TemporalAgentResultPayload,
): SqlStreamPayload {
  const baseline = data.baseline ?? 0;
  const newVal = data.new ?? 0;
  const sql =
    [data.sql_baseline, data.sql_new]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join("\n-- period B --\n") || "--";

  return {
    value: newVal,
    label: `${data.label_baseline || "Baseline"} → ${data.label_new || "New"}`,
    format: "number",
    sql,
    rows: [
      {
        baseline: baseline,
        new: newVal,
        delta_pct:
          data.delta_percent != null ? `${data.delta_percent.toFixed(2)}%` : "—",
      },
    ],
    chart: [
      { t: data.label_baseline || "A", v: baseline },
      { t: data.label_new || "B", v: newVal },
    ],
  };
}
