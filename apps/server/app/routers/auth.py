"""First-party authentication: register, login, profile, logout.

Sessions are opaque random tokens validated against PostgreSQL on every
request (see ``app.auth.sessions``). The raw token is returned exactly once
at login; logout revokes it server-side.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.sessions import (
    create_session,
    create_user,
    get_user_by_email,
    normalize_email,
    resolve_session,
    revoke_session,
    verify_password,
)
from app.config import settings
from app.db import get_session_maker

router = APIRouter(prefix="/v1/auth", tags=["auth"])

_GENERIC_LOGIN_ERROR = "Invalid email or password."
_GENERIC_REGISTER_ERROR = "Unable to complete registration."


async def _get_session() -> AsyncIterator[AsyncSession]:
    sm = get_session_maker()
    async with sm() as session:
        yield session


class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    id: str
    email: str
    role: str


class LoginOut(BaseModel):
    user: UserOut
    session_token: str
    expires_at: str


def _user_out(user) -> UserOut:
    return UserOut(id=str(user.id), email=user.email, role=user.role)


def _valid_email(raw: str) -> str | None:
    """Normalize and sanity-check an address; None when unusable."""
    email = normalize_email(raw)
    if len(email) > 320:
        return None
    local, sep, domain = email.partition("@")
    if not sep or not local or "." not in domain:
        return None
    return email


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterBody, session: AsyncSession = Depends(_get_session)
) -> UserOut:
    if not settings.allow_public_registration:
        raise HTTPException(status_code=403, detail="Registration is disabled.")
    email = _valid_email(str(body.email))
    if email is None:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if await get_user_by_email(session, email) is not None:
        # Generic failure: do not disclose whether the account exists.
        raise HTTPException(status_code=400, detail=_GENERIC_REGISTER_ERROR)
    try:
        row = await create_user(session, email, body.password)
    except IntegrityError as err:
        await session.rollback()
        raise HTTPException(status_code=400, detail=_GENERIC_REGISTER_ERROR) from err
    return _user_out(row)


@router.post("/login", response_model=LoginOut)
async def login(
    body: LoginBody, session: AsyncSession = Depends(_get_session)
) -> LoginOut:
    email = _valid_email(str(body.email))
    if email is None:
        # Same generic failure as unknown account: no enumeration signal.
        raise HTTPException(status_code=401, detail=_GENERIC_LOGIN_ERROR)
    user = await get_user_by_email(session, email)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail=_GENERIC_LOGIN_ERROR)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail=_GENERIC_LOGIN_ERROR)
    lifetime = timedelta(hours=settings.session_lifetime_hours)
    row, token = await create_session(session, user.id, lifetime)
    expires = row.expires_at
    return LoginOut(
        user=_user_out(user),
        session_token=token,
        expires_at=expires.isoformat() if expires else "",
    )


def _bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


@router.get("/me", response_model=UserOut)
async def me(request: Request, session: AsyncSession = Depends(_get_session)) -> UserOut:
    token = _bearer_token(request)
    found = await resolve_session(session, token) if token else None
    if found is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    user, _ = found
    return _user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request, session: AsyncSession = Depends(_get_session)
) -> Response:
    token = _bearer_token(request)
    if token:
        await revoke_session(session, token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
