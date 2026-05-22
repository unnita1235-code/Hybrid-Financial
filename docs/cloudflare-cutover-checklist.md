# Cloudflare Cutover Checklist

This checklist is used when moving from legacy Netlify/Render hosting to Cloudflare Pages + Workers.

## 1) One-time setup

- Create Cloudflare Pages project:
  - Production branch: `main`
  - Preview branch: `develop`
  - Root directory: `apps/web`
  - Build command: `npm ci && npm run build:web`
- Set Pages environment variables:
  - `NEXT_PUBLIC_AEQUITAS_API_URL`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Create Worker from `apps/api-worker/wrangler.jsonc`.
- Set Worker secrets/vars:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `SUPABASE_JWT_SECRET`
  - `DATABASE_URL`
  - `SYNC_DATABASE_URL`
  - Optional migration bridge: `UPSTREAM_API_BASE`

## 2) Release gates

- Require passing checks on pull requests:
  - Frontend lint + typecheck + build
  - Worker typecheck + tests
  - Backend Python tests
  - AI golden intent eval (`npm run eval:golden`)
- Merge to `develop` for preview validation.
- Merge to `main` for production deployment.

## 3) Smoke validation

- Run `npm run deploy:smoke` with:
  - `FRONTEND_URL` set to Pages URL
  - `BACKEND_URL` set to Worker URL
- Validate:
  - `/`, `/research`, `/alerts`, `/debate`, `/portfolio`
  - `${BACKEND_URL}/health`
  - Golden intent schema contract from `testing_suite/golden_intents.json`

## 4) Rollback

- Frontend rollback:
  - Cloudflare Pages -> project -> Deployments -> re-deploy previous successful commit.
- Backend rollback:
  - Cloudflare Workers -> Versions -> rollback to previous stable version.
- Temporary emergency bridge:
  - Re-enable `UPSTREAM_API_BASE` to send critical API traffic to legacy backend while issues are fixed.

## 5) Ownership and approvals

- Release approver (`main`):
  - Assign one owner to approve production merges and monitor deploy result.
- Rollback owner:
  - Assign one owner with Cloudflare Pages + Workers rollback permissions.
- Monitoring owner:
  - Assign one owner to watch deployment failures, runtime errors, and smoke-check artifacts.
- AI quality owner:
  - Assign one owner to maintain `docs/ai-launch-contract.md` and golden intent thresholds.
- Incident response owner:
  - Assign one owner to maintain `docs/incident-response-playbook.md`.
- Branch protections:
  - `main`: require PR review + required status checks before merge.
  - `develop`: require core CI checks before merge.

## 6) Sign-off artifacts

- Maintain release sign-off packet:
  - `docs/release-signoff-packet.md`
- Attach evidence from:
  - deploy smoke artifacts
  - AI eval artifact `artifacts/ai-eval/golden-intents-status.json`
