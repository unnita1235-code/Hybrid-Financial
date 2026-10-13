"""First-party auth: hashing, sessions, routes, and authorization boundaries."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from aequitas_database.models.auth import AppUser, AuthSession
from aequitas_database.models.base import Base
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth import guards
from app.auth.identity import Identity, get_identity
from app.auth.sessions import (
    create_session,
    create_user,
    hash_password,
    normalize_email,
    resolve_session,
    revoke_session,
    token_digest,
    verify_password,
)
from app.routers import auth as auth_router


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def sqlite_maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _seed_user(session: AsyncSession, email: str = "Ada@Example.COM") -> AppUser:
    return await create_user(session, email, "correct horse Zonbi3!")


# --- password hashing -------------------------------------------------------


def test_password_round_trip_and_wrong_password() -> None:
    hashed = hash_password("s3cret-pass")
    assert hashed != "s3cret-pass"
    assert hashed.startswith("pbkdf2-sha256$")
    assert verify_password("s3cret-pass", hashed)
    assert not verify_password("wrong-pass", hashed)


def test_malformed_hashes_never_verify() -> None:
    assert not verify_password("x", "")
    assert not verify_password("x", "not-a-hash")
    assert not verify_password("x", "bcrypt$10$abc$def")


def test_token_digests_are_unique_and_opaque() -> None:
    import secrets

    t1 = secrets.token_urlsafe(32)
    t2 = secrets.token_urlsafe(32)
    assert token_digest(t1) != token_digest(t2)
    assert len(token_digest(t1)) == 64
    assert t1 not in token_digest(t1)


def test_normalize_email() -> None:
    assert normalize_email("  Ada@Example.COM ") == "ada@example.com"


# --- sessions ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_lifecycle(db_session: AsyncSession) -> None:
    user = await _seed_user(db_session)
    assert user.role == "analyst"
    assert user.email == "ada@example.com"
    row, token = await create_session(db_session, user.id, timedelta(hours=24))
    assert token and isinstance(row.id, UUID)
    assert "session_token" not in repr(row)
    found = await resolve_session(db_session, token)
    assert found is not None and found[0].id == user.id
    assert await revoke_session(db_session, token) is True
    assert await resolve_session(db_session, token) is None
    # Revoking twice reports nothing left to revoke.
    assert await revoke_session(db_session, token) is False


@pytest.mark.asyncio
async def test_unknown_expired_and_inactive_sessions_rejected(
    db_session: AsyncSession,
) -> None:
    assert await resolve_session(db_session, "nope") is None
    user = await _seed_user(db_session)
    _, token = await create_session(db_session, user.id, timedelta(hours=24))
    await db_session.execute(
        update(AuthSession)
        .where(AuthSession.token_digest == token_digest(token))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db_session.commit()
    assert await resolve_session(db_session, token) is None
    # Deactivated user with a fresh session.
    _, token2 = await create_session(db_session, user.id, timedelta(hours=24))
    user.is_active = False
    await db_session.commit()
    assert await resolve_session(db_session, token2) is None


# --- routes ------------------------------------------------------------------


def _client_with_db(maker) -> TestClient:
    app = FastAPI()
    app.include_router(auth_router.router)

    async def _override():
        async with maker() as session:
            yield session

    app.dependency_overrides[auth_router._get_session] = _override
    return TestClient(app)


def test_register_login_me_logout_flow(sqlite_maker) -> None:
    client = _client_with_db(sqlite_maker)
    r = client.post(
        "/v1/auth/register",
        json={"email": "Ada@Example.COM", "password": "s3cret-pass", "role": "admin"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "ada@example.com"
    # Role escalation via registration input is ignored.
    assert body["role"] == "analyst"
    assert "session_token" not in body
    assert "password" not in body

    dup = client.post(
        "/v1/auth/register",
        json={"email": "ada@example.com", "password": "s3cret-pass"},
    )
    assert dup.status_code == 400
    # Duplicate registration must not disclose account existence.
    assert "exists" not in dup.text.lower()

    bad_login = client.post(
        "/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever123"},
    )
    assert bad_login.status_code == 401
    wrong = client.post(
        "/v1/auth/login",
        json={"email": "ada@example.com", "password": "wrong-pass"},
    )
    assert wrong.status_code == 401
    # Unknown account and wrong password produce the same generic message.
    assert wrong.json() == bad_login.json()

    ok = client.post(
        "/v1/auth/login", json={"email": "ada@example.com", "password": "s3cret-pass"}
    )
    assert ok.status_code == 200, ok.text
    token = ok.json()["session_token"]
    assert token

    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "ada@example.com"

    # Client-asserted identity headers grant nothing without a session.
    spoof = client.get(
        "/v1/auth/me", headers={"X-User-Id": "someone", "X-User-Role": "admin"}
    )
    assert spoof.status_code == 401
    assert client.get("/v1/auth/me").status_code == 401
    assert (
        client.get("/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code
        == 401
    )

    out = client.post("/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert out.status_code == 204
    assert (
        client.get(
            "/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 401
    )


def test_malformed_login_payloads_rejected(sqlite_maker) -> None:
    client = _client_with_db(sqlite_maker)
    assert (
        client.post(
            "/v1/auth/register", json={"email": "not-an-email", "password": "s3cret-pass"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/v1/auth/register", json={"email": "a@b.co", "password": "short"}
        ).status_code
        == 422
    )


def test_registration_can_be_disabled(sqlite_maker, monkeypatch) -> None:
    monkeypatch.setattr(auth_router.settings, "allow_public_registration", False)
    client = _client_with_db(sqlite_maker)
    r = client.post(
        "/v1/auth/register",
        json={"email": "new@example.com", "password": "s3cret-pass"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_header_identity_cannot_authenticate() -> None:
    scope = {
        "type": "http",
        "headers": [(b"x-user-id", b"victim"), (b"x-user-role", b"admin")],
    }
    with pytest.raises(Exception) as exc_info:
        await get_identity(Request(scope))
    assert getattr(exc_info.value, "status_code", None) == 401


@pytest.mark.asyncio
async def test_role_guard_rejects_analyst_for_admin(monkeypatch) -> None:
    async def _analyst(request):
        del request
        return Identity(sub="u", role="analyst", email="a@b.c")

    monkeypatch.setattr(guards, "get_identity", _analyst)
    dep = guards.require_role("executive", "admin", "superuser")
    scope = {"type": "http", "headers": []}
    with pytest.raises(Exception) as exc_info:
        await dep.dependency(Request(scope))
    assert getattr(exc_info.value, "status_code", None) == 403
