# PRODUCTION-READY ARCHITECTURE (Target State)

```text
aequitas-fi/
├── apps/
│   ├── web/                          # Next.js 14 App Router
│   │   ├── app/
│   │   │   ├── (auth)/               # Supabase/Clerk auth group
│   │   │   ├── dashboard/            # Main financial dashboard
│   │   │   ├── research/             # Deep research page (new)
│   │   │   ├── alerts/               # Shadow analyst notifications (new)
│   │   │   ├── portfolio/            # Portfolio tracker (new)
│   │   │   ├── debate/               # Bull/Bear debate
│   │   │   ├── reports/              # PDF memo export
│   │   │   └── admin/                # Admin panel (new)
│   │   ├── components/
│   │   │   ├── dashboard/
│   │   │   ├── charts/               # Recharts wrappers
│   │   │   ├── ai/                   # AI output components (streaming)
│   │   │   └── ui/                   # shadcn/ui
│   │   └── lib/
│   │       ├── api/                  # Typed API clients
│   │       ├── supabase/
│   │       └── hooks/                # React hooks for WS, SSE
│   │
│   └── server/                       # FastAPI + LangGraph
│       ├── app/
│       │   ├── main.py               # Lifespan: engine, graphs, scheduler
│       │   ├── config.py             # Pydantic settings (env-driven)
│       │   ├── auth/
│       │   │   ├── identity.py       # JWT verify (Supabase HS256 or Clerk RS256)
│       │   │   └── guards.py         # FastAPI Depends: require_role()
│       │   ├── graph/
│       │   │   ├── registry.py       # Central graph registry (NEW)
│       │   │   ├── sql_graph.py      # Architect → Validator → Execute
│       │   │   ├── temporal.py       # Period comparison agent
│       │   │   ├── research.py       # Deep research agent (wire existing)
│       │   │   ├── portfolio.py      # Portfolio analysis agent (NEW)
│       │   │   └── alert_triage.py   # Alert reasoning agent (NEW)
│       │   ├── routers/
│       │   │   ├── insight.py        # POST /v1/insight/stream (SSE)
│       │   │   ├── temporal.py       # WS /v1/temporal/ws
│       │   │   ├── research.py       # POST /v1/research (NEW)
│       │   │   ├── portfolio.py      # CRUD + analysis /v1/portfolio (NEW)
│       │   │   ├── alerts.py         # GET/PATCH /v1/alerts (NEW)
│       │   │   ├── debate.py         # POST /v1/debate/risk-assessment
│       │   │   ├── audit.py          # Audit trail endpoints
│       │   │   ├── reports.py        # PDF memo generation
│       │   │   ├── admin.py          # Admin: ingest trigger, system health (NEW)
│       │   │   └── health.py
│       │   ├── services/
│       │   │   ├── shadow_analyst.py # Z-score + notification (fix engine leak)
│       │   │   ├── simulator.py      # Scenario simulation
│       │   │   ├── portfolio_svc.py  # Portfolio CRUD + position calc (NEW)
│       │   │   └── alert_svc.py      # Alert read/dismiss/triage (NEW)
│       │   └── rbac/
│       │       ├── sensitive_sql.py  # Table-level RBAC
│       │       └── feature_flags.py  # Role-feature matrix (NEW)
│       ├── api/
│       │   ├── ingest.py             # PDF/doc ingestion pipeline
│       │   └── debate.py             # Debate orchestration (move to routers)
│       └── middleware/
│           ├── redactor.py           # Presidio PII (existing, good)
│           ├── rate_limiter.py       # Per-user rate limiting (NEW)
│           └── request_id.py         # X-Request-ID tracing (NEW)
│
├── packages/
│   ├── ai-core/
│   │   └── aequitas_ai/
│   │       ├── agents/
│   │       │   ├── temporal_agent.py   # Fixes applied
│   │       │   ├── research_agent.py   # Wire this
│   │       │   ├── portfolio_agent.py  # NEW
│   │       │   ├── alert_agent.py      # NEW
│   │       │   └── state.py
│   │       ├── prompts/
│   │       │   ├── sql.py
│   │       │   ├── synthesis.py
│   │       │   ├── research.py         # NEW
│   │       │   ├── portfolio.py        # NEW
│   │       │   └── debate.py           # NEW (extract from api/debate.py)
│   │       ├── tools/                  # NEW: LangGraph tool nodes
│   │       │   ├── market_data.py      # Live price fetch tool
│   │       │   ├── filing_search.py    # SEC EDGAR full-text search tool
│   │       │   └── news_tool.py        # NewsAPI tool node
│   │       ├── rag_engine.py
│   │       ├── sql_engine.py
│   │       └── research_agent.py
│   │
│   └── database/
│       └── aequitas_database/
│           ├── models/
│           │   ├── audit_log.py
│           │   ├── document_embedding.py
│           │   ├── portfolio.py        # NEW: Portfolio + Position models
│           │   └── base.py
│           └── alembic/
│               └── versions/
│                   ├── 001_initial.py
│                   ├── 002_market_data_notifications.py
│                   ├── 003_audit_trail_and_feedback.py
│                   ├── 004_market_indices_view.py
│                   └── 005_portfolio_positions.py  # NEW migration
│
├── infra/                            # NEW: Infrastructure as Code
│   ├── docker-compose.yml            # Local: Postgres + Redis + pgvector
│   ├── docker-compose.prod.yml       # Production overrides
│   └── nginx/
│       └── nginx.conf                # Reverse proxy config
│
├── .github/
│   └── workflows/
│       ├── ai-pipeline.yml           # CI: lint + pytest + DeepEval
│       └── deploy.yml                # CD: build + push (NEW)
│
└── README.md
```
