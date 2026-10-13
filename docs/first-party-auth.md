# First-party authentication & hosting

Aequitas FI uses application-managed authentication. There is no external
identity provider (no Supabase, Clerk, Firebase, or Auth0) and no hosted
database other than Render PostgreSQL.

## Architecture

- **Vercel:** Next.js frontend plus same-origin BFF routes (`apps/web/app/api/**`).
  The browser never calls the backend directly and never sees session tokens.
- **Render:** FastAPI backend (`apps/server`, `uvicorn app.main:app`) plus
  Render PostgreSQL (Postgres 16 with the `pgvector` extension).
- **Sessions:** `POST /v1/auth/login` issues a 256-bit opaque token whose
  SHA-256 digest is stored in `auth_sessions`. The Next.js BFF sets it as an
  `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`aequitas_session`, `Secure` in
  production) and forwards it as `Authorization: Bearer` server-to-server.
  The backend validates every session against PostgreSQL (existence, expiry,
  revocation, user-active) and loads the role from the stored user row.
- Passwords: PBKDF2-HMAC-SHA256, 600k iterations, per-user 32-byte salt
  (stdlib `hashlib`; see `apps/server/app/auth/sessions.py`).
- Registration always assigns the `analyst` role and is gated server-side by
  `ALLOW_PUBLIC_REGISTRATION`. There is no public promotion endpoint.

## Required environment (names only — values live in dashboards, never in Git)

Backend (Render service):
`DATABASE_URL`, `SYNC_DATABASE_URL`, `ALLOW_PUBLIC_REGISTRATION=false`,
`SESSION_LIFETIME_HOURS` (e.g. `24`), `APP_ENV=production`,
`ENVIRONMENT=production`, plus existing model keys (`OPENAI_API_KEY`, …).

Web (Vercel project):
`AEQUITAS_API_URL` — the Render backend service URL used by BFF routes.
No database credentials and no session material in public variables.

## Database

Run Alembic migrations (`packages/database/alembic`, currently through
`007_auth_identity`) against Render PostgreSQL before first boot. Never drop
existing tables; never restore from an unverified source. No data was
migrated from the deleted Supabase project — history starts empty.

## First administrator

There is no self-promotion path by design. After the first user registers,
promote them with a direct database update performed by the developer
against Render PostgreSQL, e.g. setting that user's `role` to `admin`.
New registrations otherwise remain `analyst`.

## Manual dashboard steps (not automated)

1. Provision Render PostgreSQL 16 + `pgvector`, attach its connection string.
2. Deploy the backend service (`render.yaml`, Docker, health check `/health`).
3. Run migrations against the Render database.
4. Set the Vercel `AEQUITAS_API_URL` to the Render service URL.
5. Register the first user, promote to admin via SQL, set
   `ALLOW_PUBLIC_REGISTRATION=false` if the deployment must stay closed.
