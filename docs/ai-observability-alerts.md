# AI Observability and Alert Thresholds

## Required telemetry

- Structured logs with:
  - `trace_id`
  - route path
  - upstream attempt count
  - upstream status/error
- Metrics to track:
  - `api_error_rate`
  - `api_p95_latency_ms`
  - `ai_fallback_rate`
  - `rate_limit_hits`
  - `cost_per_request_estimate`

## Launch thresholds

- Error alert:
  - Trigger if 5-minute error rate exceeds 2%.
- Latency alert:
  - Trigger if p95 latency exceeds 6000ms for AI routes over 10 minutes.
- Fallback alert:
  - Trigger if fallback responses exceed 5% of AI-route traffic over 15 minutes.
- Rate-limit anomaly:
  - Trigger if 429 rate exceeds expected daily baseline by 3x.

## Dashboard panels (minimum)

1. Request volume by route
2. Error rate by route
3. p95 latency by route
4. Upstream retries and fallback rate
5. Golden eval pass/fail trend from CI artifacts
