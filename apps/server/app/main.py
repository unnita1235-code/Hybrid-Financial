import asyncio
import logging
import sys
from contextlib import asynccontextmanager

# Psycopg async requires a selector event loop on Windows (not the default Proactor).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from aequitas_ai import DEFAULT_FINANCIAL_SCHEMA, SqlGraphConfig, build_sql_engine_graph
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_openai import ChatOpenAI
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from api.ingest import router as ingest_router
from app.config import settings
from app.graph import (
    GraphRegistry,
    get_alert_triage_graph,
    get_portfolio_graph,
    get_research_graph,
    get_temporal_graph,
)
from app.langgraph_lifespan import start_langgraph_checkpointer, stop_langgraph_checkpointer
from app.routers import health
from app.routers.admin import router as admin_router
from app.routers.alerts import router as alerts_router
from app.routers.audit import router as audit_router
from app.routers.debate import router as debate_router
from app.routers.insight import router as insight_router
from app.routers.portfolio import router as portfolio_router
from app.routers.reports import router as reports_router
from app.routers.research import router as research_router
from app.routers.simulation import router as simulation_router
from app.routers.temporal import router as temporal_router
from app.services.shadow_analyst import ShadowAnalystService
from middleware.rate_limiter import RateLimiterMiddleware
from middleware.request_id import RequestIdMiddleware

log = logging.getLogger("aequitas")


def _is_dev_mode() -> bool:
    return (settings.app_env or "dev").strip().lower() in {
        "dev",
        "development",
        "local",
        "test",
        "testing",
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.environment in ("staging", "production") and settings.auth_provider == "dev":
        raise RuntimeError(
            f"FATAL: auth_provider='dev' is not allowed in environment='{settings.environment}'. "
            "Set AUTH_PROVIDER=supabase or AUTH_PROVIDER=clerk in your environment."
        )
    if not _is_dev_mode() and (settings.auth_provider or "").strip().lower() == "dev":
        raise RuntimeError("Refusing to start with AUTH_PROVIDER=dev outside dev mode.")
    shared_engine: AsyncEngine | None = None
    app.state.sql_graph = None
    if settings.openai_api_key:
        shared_engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
        )
        llm = ChatOpenAI(
            model=settings.sql_model,
            temperature=0,
            api_key=settings.openai_api_key,
        )
        cfg = SqlGraphConfig(
            architect_llm=llm,
            validator_llm=llm,
            database_url=settings.database_url,
            max_result_rows=5_000,
            schema_ddl=DEFAULT_FINANCIAL_SCHEMA,
            async_engine=shared_engine,
        )
        app.state.sql_graph = build_sql_engine_graph(cfg)
    else:
        log.warning("OPENAI_API_KEY missing; SQL graph will not be initialized at startup.")
    app.state.checkpoint_pool = await start_langgraph_checkpointer()
    graph_registry = GraphRegistry()
    graph_registry.register("temporal", get_temporal_graph)
    graph_registry.register("research", get_research_graph)
    graph_registry.register("portfolio", get_portfolio_graph)
    graph_registry.register("alert_triage", get_alert_triage_graph)
    app.state.graph_registry = graph_registry
    if settings.shadow_analyst_enabled:
        sa = ShadowAnalystService.from_url()
        sa.start()
        app.state.shadow_analyst = sa
    else:
        app.state.shadow_analyst = None
    log.info(
        "Starting Aequitas FI | env=%s auth=%s",
        settings.environment,
        settings.auth_provider,
    )
    yield
    await stop_langgraph_checkpointer(
        getattr(app.state, "checkpoint_pool", None),
    )
    app.state.checkpoint_pool = None
    app.state.graph_registry = None
    svc: ShadowAnalystService | None = getattr(
        app.state, "shadow_analyst", None
    )
    if svc is not None:
        svc.shutdown()
        await svc.engine.dispose()
    if shared_engine is not None:
        await shared_engine.dispose()
    app.state.sql_graph = None


app = FastAPI(title=settings.app_name, lifespan=lifespan)
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(RateLimiterMiddleware)
app.include_router(health.router, tags=["system"])
app.include_router(admin_router)
app.include_router(ingest_router)
app.include_router(debate_router)
app.include_router(audit_router)
app.include_router(alerts_router)
app.include_router(reports_router)
app.include_router(insight_router)
app.include_router(temporal_router)
app.include_router(simulation_router)
app.include_router(research_router)
app.include_router(portfolio_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "sql_model": settings.sql_model,
        "synthesis_model": settings.synthesis_model,
    }
