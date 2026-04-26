"""Shared async SQLAlchemy engine / session (audit, RBAC checks, services)."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


@lru_cache
def get_session_maker() -> async_sessionmaker[AsyncSession]:
    eng = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        echo=False,
    )
    return async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
