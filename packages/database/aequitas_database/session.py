from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DEFAULT_ASYNC_URL = "postgresql+asyncpg://aequitas:aequitas_dev@localhost:5432/aequitas"


def create_session_factory(
    url: str = DEFAULT_ASYNC_URL,
) -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(url, echo=False)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


AsyncSessionFactory = create_session_factory()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionFactory() as session:
        yield session
