import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";

export async function POST(req: NextRequest) {
  const base = getBackendUrl();
  const body = (await req.json().catch(() => ({}))) as {
    audit_log_id?: string;
    vote?: 1 | -1;
    correction_text?: string | null;
  };
  if (!body.audit_log_id || (body.vote !== 1 && body.vote !== -1)) {
    return NextResponse.json(
      { error: "audit_log_id and vote (1 or -1) required" },
      { status: 400 },
    );
  }
  const r = await fetch(`${base}/v1/audit/feedback`, {
    method: "POST",
    headers: mergeRequestAuth(req, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      audit_log_id: body.audit_log_id,
      vote: body.vote,
      correction_text: body.correction_text ?? null,
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    return new NextResponse(text, { status: r.status });
  }
  return new NextResponse(text, {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
