"""First-party session credentials.

Password verification uses PBKDF2-HMAC-SHA256 (600k iterations, per-user
32-byte salt, stdlib ``hashlib`` — no additional dependency). Session tokens
are 256-bit cryptographically random opaque values; only their SHA-256 digest
is persisted. Roles always come from the stored user row.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from aequitas_database.models.auth import AppUser, AuthSession
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

_PBKDF2_ITERATIONS = 600_000
_SALT_BYTES = 32
_TOKEN_BYTES = 32
_DEFAULT_ROLE = "analyst"


def normalize_email(email: str) -> str:
    """Trim surrounding whitespace and lowercase the address (RFC 5321 local
    parts are technically case-sensitive, but this product treats the full
    address case-insensitively and documents that policy)."""
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    stretched = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return (
        "pbkdf2-sha256"
        f"${_PBKDF2_ITERATIONS}"
        f"${base64.urlsafe_b64encode(salt).decode('ascii')}"
        f"${base64.urlsafe_b64encode(stretched).decode('ascii')}"
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iterations, salt_b64, hash_b64 = password_hash.split("$")
        if scheme != "pbkdf2-sha256":
            return False
        count = int(iterations)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(hash_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, count
    )
    return hmac.compare_digest(candidate, expected)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def get_user_by_email(session: AsyncSession, email: str) -> AppUser | None:
    res = await session.execute(
        select(AppUser).where(AppUser.email == normalize_email(email))
    )
    return res.scalars().first()


async def create_user(
    session: AsyncSession, email: str, password: str
) -> AppUser:
    """Create an analyst user. The role is never taken from input."""
    row = AppUser(
        email=normalize_email(email),
        password_hash=hash_password(password),
        role=_DEFAULT_ROLE,
        is_active=True,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def create_session(
    session: AsyncSession, user_id: UUID, lifetime: timedelta
) -> tuple[AuthSession, str]:
    """Issue a session; returns (row, raw token). The raw token is returned
    exactly once and must be transmitted securely, never stored."""
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = datetime.now(UTC)
    row = AuthSession(
        user_id=user_id,
        token_digest=token_digest(token),
        created_at=now,
        expires_at=now + lifetime,
        revoked_at=None,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row, token


async def resolve_session(
    session: AsyncSession, token: str
) -> tuple[AppUser, AuthSession] | None:
    """Validate a presented token. Returns None for unknown, expired,
    revoked, or inactive-user sessions."""
    res = await session.execute(
        select(AuthSession).where(AuthSession.token_digest == token_digest(token))
    )
    row = res.scalars().first()
    if row is None or row.revoked_at is not None:
        return None
    now = datetime.now(UTC)
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires <= now:
        return None
    user = await session.get(AppUser, row.user_id)
    if user is None or not user.is_active:
        return None
    return user, row


async def revoke_session(session: AsyncSession, token: str) -> bool:
    """Revoke the session for a token. True when a live session was revoked."""
    found = await resolve_session(session, token)
    if found is None:
        return False
    _, row = found
    row.revoked_at = datetime.now(UTC)
    await session.commit()
    return True
