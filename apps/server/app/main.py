from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.debate import router as debate_router
from api.ingest import router as ingest_router
from app.config import settings
from app.routers import health
from app.routers.audit import router as audit_router
from app.routers.reports import router as reports_router
from app.routers.temporal import router as temporal_router
from app.services.shadow_analyst import ShadowAnalystService


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.shadow_analyst_enabled:
        sa = ShadowAnalystService.from_url()
        sa.start()
        app.state.shadow_analyst = sa
    else:
        app.state.shadow_analyst = None
    yield
    svc: ShadowAnalystService | None = getattr(
        app.state, "shadow_analyst", None
    )
    if svc is not None:
        svc.shutdown()
        await svc.engine.dispose()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3003",
        "http://127.0.0.1:3003",
        "http://localhost:3004",
        "http://127.0.0.1:3004",
        "http://localhost:3005",
        "http://127.0.0.1:3005",
        "http://localhost:3006",
        "http://127.0.0.1:3006",
        "http://localhost:3007",
        "http://127.0.0.1:3007",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router, tags=["system"])
app.include_router(ingest_router)
app.include_router(debate_router)
app.include_router(audit_router)
app.include_router(reports_router)
app.include_router(temporal_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "sql_model": settings.sql_model,
        "synthesis_model": settings.synthesis_model,
    }
