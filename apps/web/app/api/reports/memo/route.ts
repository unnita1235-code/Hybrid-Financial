import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";
import type { MemoReportRequest } from "@/lib/memo-reports";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<MemoReportRequest>;
  if (
    typeof body.start_date !== "string" ||
    typeof body.end_date !== "string" ||
    typeof body.metric_focus !== "string" ||
    !body.metric_focus.trim()
  ) {
    return NextResponse.json(
      { error: "start_date, end_date, and metric_focus are required" },
      { status: 400 },
    );
  }

  const base = getBackendUrl();
  const r = await fetch(`${base}/v1/reports/memo`, {
    method: "POST",
    headers: mergeRequestAuth(req, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      start_date: body.start_date,
      end_date: body.end_date,
      metric_focus: body.metric_focus.trim(),
    }),
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
