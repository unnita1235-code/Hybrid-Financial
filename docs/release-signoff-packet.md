# Release Sign-off Packet

## Build and Validation Evidence

- Web typecheck: `npm run typecheck:web` (pass required)
- Worker tests: `npm run test -w @aequitas/api-worker` (pass required)
- AI eval gate: `npm run eval:golden` (pass required)
- Deploy smoke: `npm run deploy:smoke` with production URLs (pass required)

## Go/No-Go Checklist

- [ ] UI system consistency pass complete
- [ ] Accessibility and keyboard focus pass complete
- [ ] AI guardrails active (validation, timeout/retry/fallback, rate limits)
- [ ] Observability and alerts enabled
- [ ] Cloudflare preview deployment successful
- [ ] Cloudflare production deployment successful
- [ ] Rollback path tested for Pages and Worker
- [ ] No open P0/P1 issues

## Risk Register

1. Cloudflare Pages Git integration not connected
   - Impact: preview/production auto deploy cannot start
   - Mitigation: connect GitHub repo in Pages and verify branch mapping
2. Local machine memory/pagefile constraints
   - Impact: intermittent local typecheck failures
   - Mitigation: run CI as source of truth and increase local pagefile

## Ownership

- Release approver: `<assign>`
- Incident commander: `<assign>`
- Rollback owner: `<assign>`
- AI quality owner: `<assign>`

## Deferred Items

- Advanced multi-agent orchestration
- Fine-tuning workflows
- Extended AI eval corpus beyond launch critical intents
