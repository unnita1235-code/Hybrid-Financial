# AI Launch Contract (48h Baseline)

This contract defines the non-negotiable product, reliability, and safety requirements for the initial production AI release.

## Top 3 User Tasks

1. Insight generation (`/v1/insight/stream`)
   - Output contract: streaming events ending with a `done` marker.
   - Failure behavior: emit deterministic error event with actionable message.
2. Research synthesis (`/v1/research/stream`)
   - Output contract: sub-questions, per-sub results, confidence, summary.
   - Failure behavior: timeout-safe error payload with no partial malformed data.
3. Debate risk assessment (`/v1/debate/risk-assessment`)
   - Output contract: strict JSON object with required keys and confidence.
   - Failure behavior: safe fallback JSON with `warning` field and no unhandled exception.

## Launch SLO Targets

- API availability: >= 99.5% during launch week.
- p95 latency:
  - health + static API endpoints: <= 800ms
  - AI/proxy endpoints: <= 6000ms
- Error rate: < 2% for non-user-error responses.
- Max cost/request:
  - alert/debate class endpoints <= $0.02 equivalent
  - research/insight class endpoints <= $0.08 equivalent

## Guardrails

- Request schema validation for public JSON endpoints.
- Timeout with capped retries for upstream AI routes.
- Explicit fallback response for model/upstream failures.
- Trace ID attached to all responses and logs.
- Basic per-IP rate limiting with deterministic 429 responses.

## Launch Go/No-Go

- All CI checks pass, including AI eval gate.
- Smoke checks pass on frontend and backend.
- Rollback owner and release approver assigned.
- No open P0/P1 defects.
