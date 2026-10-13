import { NextRequest, NextResponse } from "next/server";
import {
  getBackendUrl,
  isSameOriginRequest,
  sessionAuthHeaders,
} from "@/lib/aequitas-api";
import { clearSessionCookie } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "Cross-origin request refused." },
      { status: 403 },
    );
  }
  const { headers, authenticated } = sessionAuthHeaders(req);
  const base = getBackendUrl().replace(/\/$/, "");
  if (authenticated) {
    try {
      await fetch(`${base}/v1/auth/logout`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
    } catch {
      // Logout is idempotent locally: the cookie is cleared regardless of
      // upstream reachability.
    }
  }
  const res = new NextResponse(null, { status: 204 });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
