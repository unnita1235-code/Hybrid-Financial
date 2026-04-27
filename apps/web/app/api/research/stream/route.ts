import type { NextRequest } from "next/server";
import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const base = getBackendUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/v1/research/stream`, {
    method: "POST",
    headers: mergeRequestAuth(req, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query: body.query ?? "" }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: t.slice(0, 800) })}\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      },
    );
  }

  if (!res.body) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "empty upstream body" })}\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
