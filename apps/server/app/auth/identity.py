"""Resolve user id + app role from Clerk, Supabase Auth, or dev headers."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.config import settings

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Identity:
    sub: str | None
    role: str
    email: str | None = None


def _bearer(request: Request) -> str | None:
    a = request.headers.get("Authorization") or request.headers.get("authorization")
    if not a or not a.lower().startswith("bearer "):
        return None
    return a[7:].strip() or None


def _dev_identity(request: Request) -> Identity:
    role = (request.headers.get("X-User-Role") or "analyst").strip()
    sub = (request.headers.get("X-User-Id") or "dev-user").strip() or "dev-user"
    return Identity(sub=sub, role=role or "analyst")


def _supabase(token: str) -> Identity:
    if not settings.supabase_jwt_secret:
        log.warning("auth_provider=supabase but supabase_jwt_secret is not set; falling back to unverified sub")
    try:
        data = jwt.decode(
            token,
            settings.supabase_jwt_secret or "",
            algorithms=["HS256"],
            options={"verify_signature": bool(settings.supabase_jwt_secret)},
        )
    except jwt.PyJWTError as e:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Invalid Supabase JWT: {e}") from e
    sub = str(data.get("sub") or "")
    am = (data.get("app_metadata") or data.get("user_metadata") or {}) or {}
    if isinstance(am, dict):
        role = str(am.get("role") or am.get("aequitas_role") or "analyst")
    else:
        role = "analyst"
    return Identity(sub=sub or None, role=role, email=str(data.get("email") or "") or None)


def _clerk(token: str) -> Identity:
    jwks = settings.clerk_jwks_url
    if not jwks:
        raise HTTPException(
            status_code=500,
            detail="auth_provider=clerk requires CLERK_JWKS_URL (Issuance: Clerk Dashboard → API keys).",
        )
    try:
        jwk_client = PyJWKClient(jwks, cache_jwk_set_by_kid=True)
        signing = jwk_client.get_signing_key_from_jwt(token)
        ap = [p.strip() for p in (settings.clerk_authorized_parties or "").split(",") if p.strip()]
        dec_kw: dict = {
            "algorithms": ["RS256", "ES256"],
            "options": {"verify_aud": bool(ap)},
        }
        if ap:
            dec_kw["audience"] = ap[0] if len(ap) == 1 else ap
        data = jwt.decode(token, signing.key, **dec_kw)
    except jwt.PyJWTError as e:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Invalid Clerk session: {e}") from e
    sub = str(data.get("sub") or "")
    pub = (data.get("public_metadata") or {}) if isinstance(data.get("public_metadata"), dict) else {}
    role = str(pub.get("aequitas_role") or pub.get("role") or "analyst")
    org = (data.get("o") or {}) if isinstance(data.get("o"), dict) else {}
    if "role" in org and role == "analyst":
        role = str((org or {}).get("role") or role)
    return Identity(sub=sub or None, role=role, email=str(data.get("email") or "") or None)


async def get_identity(request: Request) -> Identity:
    prov = (settings.auth_provider or "dev").lower().strip()
    token = _bearer(request)
    if prov in ("", "none", "dev"):
        return _dev_identity(request)
    if not token:
        return _dev_identity(request)
    if prov == "supabase":
        return _supabase(token)
    if prov == "clerk":
        return _clerk(token)
    if settings.supabase_jwt_secret:
        return _supabase(token)
    if settings.clerk_jwks_url:
        return _clerk(token)
    return _dev_identity(request)
