import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";

type ScenarioBody = {
  what_if?: string;
  insight_query?: string;
};

/**
 * BFF: forwards to FastAPI `POST /v1/simulation/scenario`.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ScenarioBody;
  const base = getBackendUrl();
  const authHeaders = mergeRequestAuth(req, { "Content-Type": "application/json" });

  const res = await fetch(`${base}/v1/simulation/scenario`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      what_if: body.what_if ?? "",
      insight_query: body.insight_query ?? "",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let errMsg = text || res.statusText;
    try {
      const o = JSON.parse(text) as { detail?: string | string[]; error?: string };
      if (typeof o.detail === "string") {
        errMsg = o.detail;
      } else if (Array.isArray(o.detail) && o.detail[0]) {
        errMsg = String(o.detail[0]);
      } else if (o.error) {
        errMsg = o.error;
      }
    } catch {
      // keep errMsg
    }
    return NextResponse.json(
      { error: errMsg },
      { status: res.status, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    return NextResponse.json(JSON.parse(text) as object);
  } catch {
    return NextResponse.json({ error: "Invalid JSON from API" }, { status: 502 });
  }
}
