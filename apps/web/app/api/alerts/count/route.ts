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
  try {
    const r = await fetch(`${base}/v1/alerts/count`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ unread: 0, degraded: true }, { status: 200 });
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ unread: 0, degraded: true }, { status: 200 });
  }
}
