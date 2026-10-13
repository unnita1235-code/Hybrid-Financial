import { NextRequest, NextResponse } from "next/server";
import {
  getBackendUrl,
  isSameOriginRequest,
  sessionAuthHeaders,
} from "@/lib/aequitas-api";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  const { id } = await ctx.params;
  const base = getBackendUrl().replace(/\/$/, "");
  const r = await fetch(`${base}/v1/alerts/${id}/triage`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return new NextResponse(text, { status: r.status });
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
