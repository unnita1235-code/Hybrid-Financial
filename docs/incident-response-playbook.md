# Incident Response Playbook (30 Minutes)

## Scope

Use this playbook for production incidents affecting frontend availability, AI response quality, or API reliability.

## Roles

- Incident commander: coordinates response and decisions.
- Rollback owner: executes Pages/Worker rollback.
- AI quality owner: validates post-mitigation output quality.
- Comms owner: updates stakeholders.

## 0-5 minutes: Detect and classify

1. Confirm impact and severity:
   - P0: hard outage/security incident
   - P1: major user-facing degradation
2. Capture trace IDs and failing routes.
3. Freeze new deploys.

## 5-15 minutes: Mitigate

1. If API failures spike:
   - Enable fallback path and reduce request timeout.
2. If frontend deploy regression:
   - Re-deploy previous successful Pages deployment.
3. If Worker regression:
   - Roll back to previous Worker version.
4. If AI quality regression:
   - Disable risky route/feature flag and enforce safe fallback responses.

## 15-30 minutes: Stabilize and verify

1. Run smoke checks:
   - `/`, `/research`, `/alerts`, `/debate`, `/portfolio`
   - `${BACKEND_URL}/health`
2. Run AI contract eval:
   - `npm run eval:golden`
3. Publish status update with ETA and next checkpoint.

## After recovery

1. File postmortem within 24 hours:
   - root cause
   - blast radius
   - mitigation timeline
   - corrective actions
2. Add regression tests/evals to prevent recurrence.
