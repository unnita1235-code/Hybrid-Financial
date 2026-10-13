"""Resolve user identity from first-party opaque session tokens.

Sessions are issued by ``POST /v1/auth/login`` and validated against
PostgreSQL on every request (see ``app.auth.sessions``). There are no
external identity providers, no JWT verification, and no header-asserted
development identities: missing, malformed, unknown, expired, revoked, or
inactive-user sessions fail closed with 401. Roles always come from the
stored user row.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.auth.sessions import resolve_session
from app.db import get_session_maker


@dataclass(frozen=True, slots=True)
class Identity:
    sub: str | None
    role: str
    email: str | None = None


def _bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization") or request.headers.get(
        "authorization"
    )
    if not auth or not auth.lower().startswith("bearer "):
        return ""
    return auth[7:].strip()


async def get_identity(request: Request) -> Identity:
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing credentials.")
    sm = get_session_maker()
    async with sm() as session:
        found = await resolve_session(session, token)
    if found is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    user, _ = found
    return Identity(sub=str(user.id), role=user.role, email=user.email)
