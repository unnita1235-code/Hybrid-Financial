import { SESSION_COOKIE_NAME } from "@/lib/aequitas-api";

function attributes(maxAgeSeconds: number): string[] {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts;
}

/** `Set-Cookie` value carrying the opaque session token (HttpOnly). */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...attributes(maxAgeSeconds),
  ].join("; ");
}

/** `Set-Cookie` value clearing the session cookie. */
export function clearSessionCookie(): string {
  return [`${SESSION_COOKIE_NAME}=`, ...attributes(0)].join("; ");
}

/** Seconds until `expiresAt` (ISO string), clamped to [60s, 7d]. */
export function maxAgeFor(expiresAt: string): number {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 3600;
  return Math.min(Math.floor(ms / 1000), 7 * 24 * 3600);
}
