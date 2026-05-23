import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";
import type { StreamEvent } from "@/lib/insight-stream";
import { readInsightSse } from "@/lib/insight-stream";
import type { ResearchStreamEvent } from "@/lib/research-stream";
import { readResearchSse } from "@/lib/research-stream";

export type ApiRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiRequest<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body == null ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function streamInsight(
  req: Request,
  query: string,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/v1/insight/stream`, {
    method: "POST",
    headers: mergeRequestAuth(req, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Insight stream failed (${res.status})`);
  await readInsightSse(res.body, onEvent);
}

export async function streamResearch(
  req: Request,
  query: string,
  onEvent: (ev: ResearchStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/v1/research/stream`, {
    method: "POST",
    headers: mergeRequestAuth(req, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Research stream failed (${res.status})`);
  await readResearchSse(res.body, onEvent);
}
