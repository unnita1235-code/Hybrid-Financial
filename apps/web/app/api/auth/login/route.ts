import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, isSameOriginRequest } from "@/lib/aequitas-api";
import { maxAgeFor, sessionCookie } from "@/lib/auth-cookie";

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
    r = await fetch(`${base}/v1/auth/login`, {
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
  let data: { session_token?: string; expires_at?: string; user?: unknown };
  try {
    data = JSON.parse(text) as { session_token?: string; expires_at?: string };
  } catch {
    return new NextResponse("Invalid upstream response.", { status: 502 });
  }
  if (!data.session_token) {
    return new NextResponse("Invalid upstream response.", { status: 502 });
  }
  // The raw session token travels only in the HttpOnly cookie; it is never
  // exposed to browser JavaScript.
  const res = NextResponse.json({
    user: data.user ?? null,
    expires_at: data.expires_at ?? null,
  });
  res.headers.append(
    "Set-Cookie",
    sessionCookie(data.session_token, maxAgeFor(data.expires_at ?? "")),
  );
  return res;
}
