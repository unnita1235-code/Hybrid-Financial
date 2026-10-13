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
  let r: Response;
  try {
    r = await fetch(`${base}/v1/auth/me`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Authentication service unavailable. Try again later." },
      { status: 503 },
    );
  }
  const text = await r.text();
  if (!r.ok) return new NextResponse(text, { status: r.status });
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
