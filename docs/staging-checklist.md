# Staging checklist (Vercel + Render)

Target architecture only. Do not provision production resources from this file.

## Render backend (`render.yaml`, Docker)

- Service builds `apps/server/Dockerfile` and starts
  `uvicorn app.main:app` on `$PORT` (falls back to 8000 locally).
- Health check: `GET /health` → `{"status": "ok"}` (no auth required).
- Requires Render PostgreSQL 16 with the `pgvector` extension
  (migrations create it via `CREATE EXTENSION IF NOT EXISTS vector`).
- Set on the service (values in the Render dashboard, never in Git):
  `DATABASE_URL`, `SYNC_DATABASE_URL` (asyncpg / psycopg2 SQLAlchemy URLs),
  `ALLOW_PUBLIC_REGISTRATION` (`false` for closed staging),
  `SESSION_LIFETIME_HOURS` (e.g. `24`), `APP_ENV`/`ENVIRONMENT`,
  plus model keys the enabled features need (`OPENAI_API_KEY`, …).
- Run Alembic migrations (`packages/database/alembic`, head currently
  `007_auth_identity`) against the Render database before first boot.
  Migrations are additive and forward-only; never drop business tables.

## Vercel web (`vercel.json`)

- Monorepo root install (`npm ci`), build `npm run build:web`, output
  `apps/web/.next`.
- Set `AEQUITAS_API_URL` to the Render backend service URL (server-side
  only). No database credentials and no session material in public
  (`NEXT_PUBLIC_*`) variables.

## Auth staging gates

- Browser sign-in at `/login` must set the `aequitas_session` HttpOnly
  cookie; modal user flows stay on same-origin BFF routes.
- Protected BFF routes return 401 without a session and never contact
  upstream; state-changing routes additionally require same-origin.
- Register the first user, then promote to admin with a deliberate
  single-row database update (no self-promotion path exists by design).
- Close registration (`ALLOW_PUBLIC_REGISTRATION=false`) when staging
  must stay closed.

## Out of scope for staging automation

Paid tiers, custom domains, DNS, backups, secret rotation, and any
previously deployed Cloudflare Worker (decommission manually if still live).
