# Aequitas FI

**Aequitas FI** is a production-oriented **hybrid SQL + RAG** financial dashboard: structured analytics over **Postgres** (compatible with **Supabase**) and **grounded** answers using **pgvector** retrieval, orchestrated with **LangGraph** stateful agents and a **Next.js** front end.

## Portfolio / positioning

**Aequitas FI** is an **AI engineering** portfolio build that demonstrates **agentic orchestration** and **tight product UX** (“vibe” UI): a **multi-agent router** where **OpenAI o3–class models** (configurable, default `o3-mini`) own **read-only Text-to-SQL** and **Claude 3.5 Sonnet** (or GPT via override) handles **RAG-aware synthesis** and narrative, with a **PII redaction** layer (Presidio) on the synthesis path, **LangGraph** checkpoints for the **Temporal (compare periods)** flow, and a **transparency/audit** trail (prompt, SQL, RAG chunks, model versions, human feedback) suitable for financial governance demos.

| Capability | How it is expressed in this repo |
|------------|----------------------------------|
| **Hybrid SQL + RAG** | [`packages/ai-core/aequitas_ai/sql_engine.py`](packages/ai-core/aequitas_ai/sql_engine.py) (Architect → Validator → execute) + [`rag_engine.py`](packages/ai-core/aequitas_ai/rag_engine.py) + FastAPI `POST /v1/insight/stream` and Next `/api/insight/stream`. |
| **Temporal “time travel”** | [`packages/ai-core/aequitas_ai/agents/temporal_agent.py`](packages/ai-core/aequitas_ai/agents/temporal_agent.py) + `WebSocket /v1/temporal/ws` (UI: **Compare** mode). |
| **PII redactor** | [`apps/server/middleware/redactor.py`](apps/server/middleware/redactor.py) around selected LLM calls. |
| **CI** | [`.github/workflows/ai-pipeline.yml`](.github/workflows/ai-pipeline.yml) — Prettier, ESLint, `pytest`, optional DeepEval when `OPENAI_API_KEY` is set in repository secrets. |

## Architecture

| Layer | Technology | Role |
|--------|------------|------|
| **Frontend** | [Next.js](https://nextjs.org) (App Router), [Tailwind CSS](https://tailwindcss.com), [Lucide](https://lucide.dev) icons, [shadcn/ui](https://ui.shadcn.com) (configured via `components.json`) | Monochrome, dark-first dashboard UI. |
| **API & orchestration** | [FastAPI](https://fastapi.tiangolo.com), [LangGraph](https://github.com/langchain-ai/langgraph) | REST/streaming entrypoints, **stateful** agent graphs: SQL path, RAG path, and synthesis. |
| **Data** | [SQLAlchemy](https://www.sqlalchemy.org) 2, [Alembic](https://alembic.sqlalchemy.org) | Models and migrations; targets **Postgres 16 + pgvector** (same feature set you use in **Supabase**). |
| **AI (split responsibilities)** | **o3-mini** (SQL), **Claude 3.5 Sonnet** (synthesis) | o3-mini produces **read-only** SQL from schema + question; Sonnet fuses **tabular results** and **retrieved chunks** into final narrative. |
| **Shared Python** | `packages/ai-core` (`aequitas_ai`) | Prompts (`prompts/`), graph **state** (`agents/state.py`), future LangGraph **nodes** here. |
| **Shared database** | `packages/database` (`aequitas_database`) | Schemas, **Alembic** migrations, async session helpers. |

### Request flow (conceptual)

```mermaid
flowchart LR
  UI[Next.js app] --> API[FastAPI]
  API --> G[LangGraph]
  G --> SQL[o3-mini SQL]
  G --> RAG[pgvector RAG]
  SQL --> DB[(Postgres + pgvector)]
  RAG --> DB
  G --> Syn[Claude 3.5 Sonnet]
  Syn --> API
  API --> UI
```

- **Supabase in production:** point `DATABASE_URL` / `SYNC_DATABASE_URL` at the Supabase **connection string**; keep **pgvector** enabled for the same migration story as local Docker.

### Hybrid execution pipeline (dashboard, default)

1. **Intent:** user question in the command bar (**Hybrid insight**).  
2. **SQL graph:** Architect → Validator (lint / forbidden DML) → read-only `SELECT` (execute).  
3. **RAG:** optional Supabase `match_rag_chunks` (or your RPC) when `SUPABASE_URL` + service key and embeddings are set.  
4. **Synthesis:** narrative with mandatory **sources** (SQL + document metadata) and a trend keyword tie-in to RAG text where applicable.  
5. **Audit:** an `audit_logs` row is opened and completed for each stream; **Thumbs** use `human_feedback` when the BFF is enabled.

**Compare periods** uses the same DB but the **Temporal** LangGraph over WebSocket (with **Postgres checkpointer** when `USE_POSTGRES_CHECKPOINTER` is true and the DB is reachable; otherwise in-memory). On Windows, the API sets a **selector event loop** so `psycopg` works with the LangGraph Postgres checkpointer.

## Repository layout

```text
.
├── apps/
│   ├── web/
│   │   ├── app/             # dashboard, research, alerts, portfolio, debate, reports, admin
│   │   ├── components/      # dashboard, charts, ai, ui
│   │   └── lib/             # api adapters, hooks, streams/ws, supabase
│   └── server/
│       ├── app/             # routers, auth, graph registry, services, rbac
│       ├── api/             # ingest + debate orchestration
│       └── middleware/      # redactor, rate limiter, request id
├── packages/
│   ├── database/            # aequitas_database models + Alembic migrations
│   └── ai-core/             # agents, prompts, tools, sql/rag engines
├── infra/
│   ├── docker-compose.yml      # Local Postgres + Redis (pgvector image)
│   ├── docker-compose.prod.yml # Production stack
│   └── nginx/nginx.conf        # Reverse proxy template
├── .github/workflows/
│   ├── ai-pipeline.yml
│   └── deploy.yml
├── requirements-local.txt
└── README.md
```

## Local prerequisites

- **Node.js 20+** (for the web app)
- **Python 3.11+** (for API and packages)
- **Docker** (for `docker-compose` database)

## Local infrastructure

From the repository root:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Default Postgres connection (matches `infra/docker-compose.yml`):

- **URL (async, e.g. SQLAlchemy):** `postgresql+asyncpg://aequitas:aequitas_dev@localhost:5432/aequitas`
- **URL (sync, e.g. Alembic with psycopg2):** `postgresql+psycopg2://aequitas:aequitas_dev@localhost:5432/aequitas`

Migrations (from `packages/database`):

```bash
# optional: set SYNC_DATABASE_URL for non-default host/user/db
set SYNC_DATABASE_URL=postgresql+psycopg2://aequitas:aequitas_dev@localhost:5432/aequitas
cd packages/database
..\.venv\Scripts\alembic upgrade head
```

(Use `alembic` from the same venv that has the package installed, or `python -m alembic` after `pip install -e .`.)

## Production-style compose

Start production-shaped services (API + Postgres + Redis):

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

Nginx reverse proxy template: `infra/nginx/nginx.conf`.

## Python environment

From the **repository root**:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-local.txt
```

This installs, in order: **`aequitas-database`**, **`aequitas-ai`**, and the **FastAPI** app in `apps/server`.

Run the API:

```bash
cd apps\server
uvicorn app.main:app --reload --port 8000
```

- Health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)  
- Copy `apps\server\.env.example` to `.env` and set API keys and model names as you wire providers.

## Frontend

From `apps/web` (or use `npm` / `pnpm` with workspace scripts when `pnpm` is available):

```bash
cd apps\web
npm install
npm run dev
```

- App: [http://127.0.0.1:3000](http://127.0.0.1:3000)  
- **shadcn/ui:** run `npx shadcn@latest add <component>` inside `apps/web` to add components to `components/ui/`.

## Model routing

Configured in `apps/server/app/config.py` (and overridable via environment):

- **`sql_model`** — default `o3-mini` for SQL generation.
- **`synthesis_model`** — default `claude-3-5-sonnet-20241022` for final answers.

Wire your provider clients (OpenAI, Anthropic, or unified gateways) in the LangGraph nodes as you build them.

## GitHub Actions

- **[`.github/workflows/ai-pipeline.yml`](.github/workflows/ai-pipeline.yml)** — `push` / `pull_request` on `main`: Prettier + ESLint on `apps/web`, `pip install -r requirements-local.txt` + `testing_suite` deps, `pytest`, faithfulness demo script, optional DeepEval when **`OPENAI_API_KEY`** (and for full RAG tests, Supabase secrets as configured) is present.  
- **[`.github/workflows/github-action.yml`](.github/workflows/github-action.yml)** — additional secret scan and builds on a broader set of branches; keep in sync with your branch strategy.
- **[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)** — automated deployment pipeline for Vercel (frontend) and Railway (backend), including smoke checks.

**Secrets (AI eval job):** add **`OPENAI_API_KEY`**; optionally **`SUPABASE_URL`** and **`SUPABASE_SERVICE_KEY`** for tests that call vector RPCs.

## Automated Vercel + Railway deploy

Deployment automation scripts are in `scripts/deploy/`:

- `bootstrap-vercel.js` and `bootstrap-railway.js` for browser-assisted onboarding with CAPTCHA/OTP checkpoints.
- `setup-vercel-project.js` and `setup-railway-service.js` for API-driven project/service provisioning and env setup.
- `smoke-check.js` for post-deploy health verification.

Full runbook: [`docs/deployment-runbook.md`](docs/deployment-runbook.md).

## Conventions

- **SQL safety:** only **read-only** SQL from the LLM; validate and execute in a **restricted** DB role in production.
- **Vectors:** `document_embeddings` uses **HNSW** (cosine) in the initial migration; align **embedding dimension** (`1536` placeholder) with your embedding model in both Alembic and `DocumentEmbedding`.
- **Reserved names:** the JSON column is named **`chunk_metadata`** (not `metadata`) to avoid clashing with SQLAlchemy’s `Base.metadata`.

---

*Internal codename: Aequitas FI — hybrid financial intelligence stack.*
