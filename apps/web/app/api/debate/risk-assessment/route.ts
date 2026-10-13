import { NextRequest, NextResponse } from "next/server";
import {
  getBackendUrl,
  isSameOriginRequest,
  sessionAuthHeaders,
} from "@/lib/aequitas-api";
import type { DebateRiskRequest } from "@/lib/debate";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "Cross-origin request refused." },
      { status: 403 },
    );
  }
  const { headers, authenticated } = sessionAuthHeaders(req);
  if (!authenticated) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<DebateRiskRequest>;
  if (typeof body.metric !== "string" || !body.metric.trim()) {
    return NextResponse.json({ error: "metric is required" }, { status: 400 });
  }

  const base = getBackendUrl();
  const r = await fetch(`${base}/v1/debate/risk-assessment`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ metric: body.metric.trim() }),
  });

  if (!r.ok) {
    const t = await r.text();
    return new NextResponse(t, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return NextResponse.json(await r.json());
}
