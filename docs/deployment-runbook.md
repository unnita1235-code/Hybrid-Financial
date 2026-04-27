# Deployment Runbook (Netlify + Render)

This runbook describes production deployment from GitHub Actions to Netlify (frontend) and Render (backend), plus browser-level smoke checks and failure handling.

## 1) Prerequisites

- Repository is connected to GitHub Actions.
- Netlify site already exists and you have its site ID.
- Render web service already exists and you have its service ID.
- Backend service uses [`apps/server/Dockerfile`](../apps/server/Dockerfile).

## 2) Repository configuration files

- Frontend deploy config: [`netlify.toml`](../netlify.toml)
- Backend blueprint config: [`render.yaml`](../render.yaml)
- Deploy workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## 3) Required GitHub secrets

Create two GitHub Environments first: `staging` and `production`.

Add these secrets in each environment before running deploy:

- Provider auth/identifiers:
  - `NETLIFY_AUTH_TOKEN`
  - `NETLIFY_SITE_ID`
  - `RENDER_API_KEY`
  - `RENDER_SERVICE_ID`
- Runtime URLs (used in smoke checks):
  - `FRONTEND_URL` (Netlify production URL)
  - `BACKEND_URL` (Render production URL)
- Frontend runtime config:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Optional rollback secret:

- `NETLIFY_LAST_KNOWN_GOOD_DEPLOY_ID`

## 4) Required provider-side runtime variables

Set backend environment variables in Render dashboard for the service:

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
2. Runs pre-deploy checks (web lint/build + backend tests).
3. Deploys frontend to Netlify using `netlify-cli`.
4. Triggers backend deployment via Render API and waits until status is `live`.
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

- Frontend: if `NETLIFY_LAST_KNOWN_GOOD_DEPLOY_ID` is configured, workflow triggers Netlify deploy restore.
- Backend: workflow triggers a Render redeploy fallback to recover from transient deployment issues.
- If failures persist, revert the problematic `main` commit and re-run deployment.

## 8) Operations checklist

- Rotate `NETLIFY_AUTH_TOKEN` and `RENDER_API_KEY` regularly.
- Keep `FRONTEND_URL` and `BACKEND_URL` aligned with production domains.
- Review uploaded `deploy-smoke-artifacts` on failed runs.
