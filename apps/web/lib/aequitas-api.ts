/**
 * BFF → FastAPI. Authenticated routes forward the caller's session as an
 * upstream Bearer credential (see {@link sessionAuthHeaders}); the backend
 * validates the opaque session against PostgreSQL.
 */
export function getBackendUrl(): string {
  const configured = [
    process.env.AEQUITAS_API_URL,
    process.env.NEXT_PUBLIC_AEQUITAS_API_URL,
  ]
    .map((v) => v?.trim())
    .find((v) => v);
  return configured ?? "http://127.0.0.1:8000";
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

export const SESSION_COOKIE_NAME = "aequitas_session";

/** Read the raw session token from the incoming request's HttpOnly cookie. */
export function getSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Upstream auth headers for protected BFF routes. Forwards the caller's
 * session as `Authorization: Bearer <token>` for backend validation.
 * Returns `authenticated: false` (and no credential) when the request
 * carries no session cookie — callers must reject with 401 without
 * contacting upstream. Never mints identity from headers or defaults.
 */
export function sessionAuthHeaders(
  req: Request,
  base: Record<string, string> = {},
): { headers: Record<string, string>; authenticated: boolean } {
  const token = getSessionToken(req);
  if (!token) return { headers: { ...base }, authenticated: false };
  return {
    headers: { ...base, Authorization: `Bearer ${token}` },
    authenticated: true,
  };
}

/**
 * Same-origin check for cookie-authenticated state-changing BFF routes.
 * Compares the request Origin (falling back to Referer) against the
 * request's own origin. Missing or mismatched origins are rejected.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";
  const candidate = origin || referer;
  if (!candidate) return false;
  try {
    const from = new URL(candidate).origin;
    const url = new URL(req.url);
    return from === url.origin;
  } catch {
    return false;
  }
}
