import { Hono } from "hono";
import type { Context } from "hono";

type Env = {
  UPSTREAM_API_BASE?: string;
  APP_ENV?: string;
  ENVIRONMENT?: string;
};

const app = new Hono<{ Bindings: Env }>();

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
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Role, X-User-Id");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
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
    used_rag: false,
    used_sql: false,
    warning: "Worker bootstrap response",
  });
});

function shouldProxy(pathname: string): boolean {
  return PASS_THROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function proxyToUpstream(c: Context<{ Bindings: Env }>) {
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
  const target = `${upstream}${requestUrl.pathname}${requestUrl.search}`;
  const req = new Request(target, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    redirect: "follow",
  });
  const res = await fetch(req);
  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
}

app.all("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  if (shouldProxy(path)) {
    return proxyToUpstream(c);
  }
  return c.notFound();
});

export default app;
