# Deployment Runbook (Cloudflare Pages + Workers)

This runbook describes production deployment using Cloudflare Pages (frontend) and Cloudflare Workers (API), with GitHub Actions quality gates, smoke checks, and rollback guidance.

## 1) Prerequisites

- Repository is connected to GitHub Actions.
- Cloudflare account has:
  - A Pages project connected to this repository.
  - A Workers API token with deploy permissions.
- Frontend branch mapping in Pages:
  - `main` -> production
  - `develop` -> preview

## 2) Repository configuration files

- Backend worker config: [`apps/api-worker/wrangler.jsonc`](../apps/api-worker/wrangler.jsonc)
- Deploy workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## 3) Required GitHub secrets

Create two GitHub Environments first: `staging` and `production`.

Add these secrets in each environment before running deploy:

- Provider auth/identifiers:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Runtime URLs (used in smoke checks):
  - `FRONTEND_URL` (Cloudflare Pages production URL)
  - `BACKEND_URL` (Cloudflare Worker API URL)
- Frontend runtime config:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Migration bridge (optional but recommended while porting endpoints):
  - `UPSTREAM_API_BASE` (legacy Python API URL, used by Worker pass-through)

## 4) Required provider-side runtime variables

Set backend environment variables in Cloudflare Worker settings:

- `DATABASE_URL`
- `SYNC_DATABASE_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_JWT_SECRET`
- `APP_ENV=production`
- `ENVIRONMENT=production`

## 5) How deployment works

On push to `main` or `develop` (or manual dispatch), [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) executes:

1. Validates all required deployment secrets are present.
2. Runs pre-deploy checks (web lint/typecheck/build + worker checks + backend tests).
3. Deploys API to Cloudflare Workers using `wrangler deploy`.
4. Frontend deploy is automatic via Cloudflare Pages Git integration.
5. Runs Playwright smoke checks on deployed URLs.
6. Uploads smoke artifacts from `artifacts/deploy-smoke`.
7. If deployment/smoke fails, runs rollback/fallback handling.

Environment routing is automatic:

- `main` -> GitHub Environment `production`
- `develop` -> GitHub Environment `staging`

## 6) Smoke tests (local/manual)

From repo root:

```bash
npm ci
npx playwright install chromium
set FRONTEND_URL=https://your-netlify-url
set BACKEND_URL=https://your-render-url
npm run deploy:smoke
```

Checks include:

- Browser navigation for frontend routes: `/`, `/research`, `/alerts`, `/debate`
- Backend health endpoint: `/health`

## 7) Rollback behavior

- Frontend: rollback from Cloudflare Pages deployment history.
- Backend: rollback using Cloudflare Workers version rollback.
- If failures persist, revert the problematic `main` commit and re-run deployment.

## 8) Operations checklist

- Rotate `CLOUDFLARE_API_TOKEN` regularly.
- Keep `FRONTEND_URL` and `BACKEND_URL` aligned with production domains.
- Review uploaded `deploy-smoke-artifacts` on failed runs.
