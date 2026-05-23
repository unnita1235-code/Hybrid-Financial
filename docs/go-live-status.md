# Enterprise Go-Live Status

## Completed

- Enterprise UI foundation:
  - design token refresh in `apps/web/app/globals.css`
  - typography upgrade to Inter + JetBrains Mono in `apps/web/app/layout.tsx` and `apps/web/tailwind.config.ts`
  - reusable page template in `apps/web/components/layout/page-template.tsx`
  - template adoption on core pages (`alerts`, `portfolio`, `debate`)
- AI hardening suite:
  - launch contract in `docs/ai-launch-contract.md`
  - observability thresholds in `docs/ai-observability-alerts.md`
  - runtime guardrails in `apps/api-worker/src/index.ts`
  - golden eval dataset and gate in `testing_suite/golden_intents.json` + `testing_suite/eval_golden_intents.js`
- Governance artifacts:
  - incident playbook `docs/incident-response-playbook.md`
  - release sign-off packet `docs/release-signoff-packet.md`
  - runbook/checklist updates in deployment docs

## Current External Blockers

1. Cloudflare Pages Git integration remains disconnected:
   - `aequitas-web` shows `Git Provider: No`.
   - Result: preview/production Pages auto-deploy cannot trigger.
2. GitHub branch protection automation is blocked in this shell:
   - GitHub CLI/token is unavailable in this runtime.

## Manual Actions Required

1. In Cloudflare Pages (`aequitas-web`):
   - Connect repo `unnita1235-code/Hybrid-Financial`
   - Verify branch mapping: `main` production, `develop` preview
2. In GitHub repo settings:
   - Enable branch protections for `main` and `develop`
   - Require CI checks defined in `.github/workflows/deploy.yml`

## Validation Commands

- `npm run typecheck:web`
- `npm run test -w @aequitas/api-worker`
- `npm run eval:golden`
- `npm run deploy:smoke` (after Pages deploy is active)
