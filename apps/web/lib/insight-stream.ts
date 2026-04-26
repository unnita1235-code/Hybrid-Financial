/**
 * Event shapes from POST /api/insight/stream (text/event-stream).
 */

export type SqlStreamPayload = {
  value: number;
  label: string;
  format: "currency" | "percent" | "number";
  sql: string;
  rows: Record<string, string | number | null>[];
  chart: { t: string; v: number }[];
};

export type RagChunkSummary = {
  id?: string;
  source: string;
  content_preview: string;
};

export type TransparencyPayload = {
  auditId: string;
  promptTemplate: string;
  modelVersions: Record<string, string>;
  ragChunks: RagChunkSummary[];
  sql: string;
};

export type StreamEvent =
  | { type: "transparency"; data: TransparencyPayload }
  | { type: "sql"; data: SqlStreamPayload }
  | { type: "narrative"; delta: string }
  | { type: "done"; auditId: string }
  | { type: "error"; message: string };

/**
 * Read one SSE (newline-delimited) stream from a fetch response body; invokes
 * `onEvent` for each ``data: {...}`` line.
 */
export async function readInsightSse(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  if (!body) {
    onEvent({ type: "error", message: "No response body" });
    return;
  }
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.trim();
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      let ev: StreamEvent;
      try {
        ev = JSON.parse(raw) as StreamEvent;
      } catch {
        continue;
      }
      onEvent(ev);
    }
  }
}

export function formatMetricValue(value: number, format: SqlStreamPayload["format"]) {
  if (format === "currency")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
