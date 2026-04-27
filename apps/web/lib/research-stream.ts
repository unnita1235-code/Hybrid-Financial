export type ResearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "sub_question"; index: number; question: string }
  | { type: "sub_result"; index: number; sql_summary: string; rag_hits: number }
  | { type: "discrepancy_warning" }
  | { type: "summary"; text: string }
  | { type: "confidence"; score: number }
  | { type: "done" }
  | { type: "error"; message: string };

export async function readResearchSse(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (ev: ResearchStreamEvent) => void,
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
      try {
        onEvent(JSON.parse(raw) as ResearchStreamEvent);
      } catch {
        // Ignore malformed event fragments.
      }
    }
  }
}
