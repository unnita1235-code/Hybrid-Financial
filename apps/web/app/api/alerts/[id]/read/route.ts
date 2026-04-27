import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, mergeRequestAuth } from "@/lib/aequitas-api";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const base = getBackendUrl().replace(/\/$/, "");
  const r = await fetch(`${base}/v1/alerts/${id}/read`, {
    method: "PATCH",
    headers: mergeRequestAuth(req),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return new NextResponse(text, { status: r.status });
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
