import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, isSameOriginRequest } from "@/lib/aequitas-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "Cross-origin request refused." },
      { status: 403 },
    );
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const base = getBackendUrl().replace(/\/$/, "");
  let r: Response;
  try {
    r = await fetch(`${base}/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
