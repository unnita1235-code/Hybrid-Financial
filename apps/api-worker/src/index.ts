import { Hono } from "hono";
import type { Context } from "hono";

type Env = {
  UPSTREAM_API_BASE?: string;
  APP_ENV?: string;
  ENVIRONMENT?: string;
  REQUEST_TIMEOUT_MS?: string;
  UPSTREAM_RETRY_ATTEMPTS?: string;
  MAX_TOOL_CALL_DEPTH?: string;
  RATE_LIMIT_PER_MINUTE?: string;
};

const app = new Hono<{ Bindings: Env }>();
const inMemoryRateLimit = new Map<string, { count: number; windowStart: number }>();
const SAFE_MAX_TOOL_CALL_DEPTH = 4;
const SAFE_REQUEST_TIMEOUT_MS = 15000;
const SAFE_UPSTREAM_RETRIES = 2;
const SAFE_RATE_LIMIT_PER_MINUTE = 120;

const PASS_THROUGH_PREFIXES = [
  "/v1/research",
  "/v1/debate",
  "/v1/alerts",
  "/v1/portfolio",
  "/v1/reports",
  "/v1/audit",
  "/v1/insight",
  "/v1/simulation",
  "/v1/temporal",
];

app.use("*", async (c, next) => {
  const traceId = crypto.randomUUID();
  c.header("X-Trace-Id", traceId);
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Role, X-User-Id");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const limit = Number.parseInt(c.env?.RATE_LIMIT_PER_MINUTE ?? "", 10) || SAFE_RATE_LIMIT_PER_MINUTE;
  const slot = inMemoryRateLimit.get(ip) ?? { count: 0, windowStart: now };
  if (now - slot.windowStart >= windowMs) {
    slot.count = 0;
    slot.windowStart = now;
  }
  slot.count += 1;
  inMemoryRateLimit.set(ip, slot);
  if (slot.count > limit) {
    return c.json(
      {
        error: "rate_limit_exceeded",
        trace_id: traceId,
      },
      429,
    );
  }

  return next();
});

app.get("/", (c) =>
  c.json({
    service: "Aequitas API Worker",
    environment: c.env.ENVIRONMENT ?? "production",
    app_env: c.env.APP_ENV ?? "production",
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/v1/alerts/count", (c) => c.json({ unread: 0, degraded: false }));

app.get("/v1/alerts", (c) => {
  const unreadOnly = c.req.query("unread_only") === "true";
  const alerts = [
    {
      id: "bootstrap-1",
      title: "Cloudflare migration active",
      severity: "info",
      read_at: null,
      created_at: new Date().toISOString(),
      z_score: 0.0,
    },
  ];
  return c.json(unreadOnly ? alerts.filter((a) => !a.read_at) : alerts);
});

app.post("/v1/alerts/:id/triage", (c) =>
  c.json({
    id: c.req.param("id"),
    status: "triaged",
    triaged_at: new Date().toISOString(),
  }),
);

app.patch("/v1/alerts/:id/read", (c) =>
  c.json({
    id: c.req.param("id"),
    status: "read",
    read_at: new Date().toISOString(),
  }),
);

app.get("/v1/portfolio/summary", (c) =>
  c.json({
    total_value: 0,
    pnl_24h: 0,
    positions: [],
    status: "bootstrap",
  }),
);

app.post("/v1/debate/risk-assessment", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { metric?: string };
  if (!body.metric || typeof body.metric !== "string" || body.metric.trim().length < 2) {
    return c.json(
      {
        error: "invalid_request",
        detail: "metric must be a non-empty string",
        trace_id: c.req.header("x-trace-id") ?? crypto.randomUUID(),
      },
      400,
    );
  }
  const metric = (body.metric ?? "risk_metric").toString();
  return c.json({
    metric,
    conviction: 0.51,
    e_bull: 0.5,
    e_bear: 0.5,
    w1: 0.5,
    w2: 0.5,
    judge_synthesis:
      "Baseline Worker response. Set UPSTREAM_API_BASE to preserve legacy model-backed debate while migration is in progress.",
    bull_argument: "Short-term indicators can support upside continuation.",
    bear_argument: "Macro uncertainty can weaken confidence in near-term momentum.",
    sql: null,
    sql_rows_preview: [],
    rag_sources: [],
    citations: [],
    confidence: "medium",
    used_rag: false,
    used_sql: false,
    warning: "Worker bootstrap response",
  });
});

function shouldProxy(pathname: string): boolean {
  return PASS_THROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function proxyToUpstream(c: Context<{ Bindings: Env }>) {
  const traceId = c.req.header("x-trace-id") ?? crypto.randomUUID();
  const upstream = (c.env.UPSTREAM_API_BASE ?? "").replace(/\/$/, "");
  if (!upstream) {
    return c.json(
      {
        error:
          "UPSTREAM_API_BASE is not configured. Set it to your legacy API during migration, or implement this route natively in the worker.",
      },
      501,
    );
  }

  const requestUrl = new URL(c.req.url);
  const toolDepth = Number.parseInt(requestUrl.searchParams.get("tool_depth") ?? "0", 10);
  const maxToolDepth = Number.parseInt(c.env.MAX_TOOL_CALL_DEPTH ?? "", 10) || SAFE_MAX_TOOL_CALL_DEPTH;
  if (toolDepth > maxToolDepth) {
    return c.json(
      {
        error: "max_tool_call_depth_exceeded",
        trace_id: traceId,
      },
      400,
    );
  }

  const target = `${upstream}${requestUrl.pathname}${requestUrl.search}`;
  const timeoutMs = Number.parseInt(c.env.REQUEST_TIMEOUT_MS ?? "", 10) || SAFE_REQUEST_TIMEOUT_MS;
  const retryAttempts = Number.parseInt(c.env.UPSTREAM_RETRY_ATTEMPTS ?? "", 10) || SAFE_UPSTREAM_RETRIES;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(c.req.raw.headers);
      headers.set("X-Trace-Id", traceId);
      headers.set("X-AI-Route", "proxy");
      const req = new Request(target, {
        method: c.req.method,
        headers,
        body: c.req.raw.body,
        redirect: "follow",
        signal: controller.signal,
      });
      const res = await fetch(req);
      clearTimeout(timeout);
      const outHeaders = new Headers(res.headers);
      outHeaders.set("X-Trace-Id", traceId);
      outHeaders.set("X-Upstream-Attempt", String(attempt + 1));
      console.log(
        JSON.stringify({
          event: "upstream_proxy_response",
          trace_id: traceId,
          path: requestUrl.pathname,
          attempt: attempt + 1,
          status: res.status,
        }),
      );
      return new Response(res.body, {
        status: res.status,
        headers: outHeaders,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const isLastAttempt = attempt === retryAttempts;
      if (isLastAttempt) break;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  console.error(
    JSON.stringify({
      event: "upstream_proxy_failed",
      trace_id: traceId,
      path: requestUrl.pathname,
      retries: retryAttempts + 1,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    }),
  );

  return c.json(
    {
      error: "upstream_unavailable",
      fallback: true,
      message: "The AI upstream is temporarily unavailable. Please retry shortly.",
      trace_id: traceId,
    },
    503,
  );
}

app.all("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  if (shouldProxy(path)) {
    return proxyToUpstream(c);
  }
  return c.notFound();
});

export default app;
