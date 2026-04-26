/**
 * BFF → FastAPI. In production, forward `Authorization` from Clerk or Supabase;
 * for local dev, use X-User-Role / X-User-Id or env fallbacks.
 */
export function getBackendUrl(): string {
  return (
    process.env.AEQUITAS_API_URL ??
    process.env.NEXT_PUBLIC_AEQUITAS_API_URL ??
    "http://127.0.0.1:8000"
  );
}

/** WebSocket base URL (FastAPI), matching {@link getBackendUrl} host/scheme. */
export function getBackendWsUrl(): string {
  const raw = getBackendUrl().replace(/\/$/, "");
  if (raw.startsWith("https://")) {
    return `wss://${raw.slice("https://".length)}`;
  }
  if (raw.startsWith("http://")) {
    return `ws://${raw.slice("http://".length)}`;
  }
  return "ws://127.0.0.1:8000";
}

export function devUserHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const role = process.env.AEQUITAS_DEV_USER_ROLE;
  const id = process.env.AEQUITAS_DEV_USER_ID;
  if (role) h["X-User-Role"] = role;
  if (id) h["X-User-Id"] = id;
  return h;
}

export function mergeRequestAuth(
  req: Request,
  base: Record<string, string> = {},
): Record<string, string> {
  const out = { ...base };
  const ar = req.headers.get("authorization");
  if (ar) out["Authorization"] = ar;
  const role = req.headers.get("x-user-role");
  const uid = req.headers.get("x-user-id");
  if (role) out["X-User-Role"] = role;
  if (uid) out["X-User-Id"] = uid;
  if (!ar && !role) {
    Object.assign(out, devUserHeaders());
    if (!out["X-User-Role"]) out["X-User-Role"] = "analyst";
    if (!out["X-User-Id"]) out["X-User-Id"] = "dev-user";
  }
  return out;
}
