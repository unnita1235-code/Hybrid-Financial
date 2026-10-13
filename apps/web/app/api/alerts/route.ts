import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, sessionAuthHeaders } from "@/lib/aequitas-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { headers, authenticated } = sessionAuthHeaders(req);
  if (!authenticated) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const base = getBackendUrl().replace(/\/$/, "");
  const query = req.nextUrl.search || "?unread_only=true&limit=50";
  const r = await fetch(`${base}/v1/alerts${query}`, {
    method: "GET",
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
