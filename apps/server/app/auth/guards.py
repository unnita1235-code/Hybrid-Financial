"""FastAPI auth guards built on top of identity resolution."""

from __future__ import annotations

from collections.abc import Callable, Iterable

from fastapi import Depends, HTTPException, Request

from app.auth.identity import Identity, get_identity


def _normalize_roles(*allowed_roles: str | Iterable[str]) -> set[str]:
    normalized: set[str] = set()
    for role in allowed_roles:
        if isinstance(role, str):
            candidate = role.strip().lower()
            if candidate:
                normalized.add(candidate)
            continue
        if isinstance(role, Iterable):
            for item in role:
                if not isinstance(item, str):
                    continue
                candidate = item.strip().lower()
                if candidate:
                    normalized.add(candidate)
    return normalized


def require_role(*allowed_roles: str | Iterable[str]) -> Depends:
    normalized = _normalize_roles(*allowed_roles)

    async def _guard(request: Request) -> Identity:
        identity = await get_identity(request)
        if not normalized or identity.role.lower() in normalized:
            return identity
        raise HTTPException(
            status_code=403,
            detail=f"Role '{identity.role}' is not authorized. Allowed: {sorted(normalized)}",
        )

    return Depends(_guard)


def require_any_role(allowed_roles: list[str]) -> Depends:
    return require_role(*allowed_roles)


def role_guard_factory(feature_roles: Callable[[str], list[str]]) -> Callable[[str], Depends]:
    def _guard(feature_name: str) -> Depends:
        return require_any_role(feature_roles(feature_name))

    return _guard
