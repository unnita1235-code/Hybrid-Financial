/**
 * Client + server: types and helpers for `POST /v1/reports/memo`.
 */

export type MemoReportRequest = {
  start_date: string;
  end_date: string;
  metric_focus: string;
};

export type MemoReportResponse = {
  metric_focus: string;
  start_date: string;
  end_date: string;
  sql_context: string;
  sql_summary: string;
  rag_narrative_hint: string;
  draft: string;
  news_headlines: string[];
  counter_arguments: string[];
  risk_factors: string[];
  final_memo: string;
  model_synthesis: string;
  used_llm: boolean;
  used_news_api: boolean;
};

export async function generateMemo(
  body: MemoReportRequest,
  init?: RequestInit,
): Promise<MemoReportResponse> {
  const r = await fetch("/api/reports/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: JSON.stringify(body),
    ...init,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return (await r.json()) as MemoReportResponse;
}
