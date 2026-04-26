export type DebateRiskRequest = {
  metric: string;
};

export type DebateRiskResponse = {
  metric: string;
  conviction: number;
  e_bull: number;
  e_bear: number;
  w1: number;
  w2: number;
  judge_synthesis: string;
  bull_argument: string;
  bear_argument: string;
  sql: string | null;
  sql_rows_preview: Array<Record<string, unknown>>;
  rag_sources: Array<{ source: string; snippet: string }>;
  used_rag: boolean;
  used_sql: boolean;
  warning: string | null;
};

export async function generateDebateRiskAssessment(
  body: DebateRiskRequest,
  init?: RequestInit,
): Promise<DebateRiskResponse> {
  const r = await fetch("/api/debate/risk-assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: JSON.stringify(body),
    ...init,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return (await r.json()) as DebateRiskResponse;
}
