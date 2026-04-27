"""Role-to-feature matrix used by API guard dependencies."""

from __future__ import annotations

from app.config import settings
from app.rbac.sensitive_sql import role_is_elevated

_DEFAULT_MATRIX: dict[str, list[str]] = {
    "dashboard": ["analyst", "manager", "executive", "admin", "superuser"],
    "research": ["analyst", "manager", "executive", "admin", "superuser"],
    "alerts": ["analyst", "manager", "executive", "admin", "superuser"],
    "portfolio": ["analyst", "manager", "executive", "admin", "superuser"],
    "admin": ["admin", "superuser"],
}


def allowed_roles(feature: str) -> list[str]:
    key = (feature or "").strip().lower()
    roles = _DEFAULT_MATRIX.get(key, ["admin", "superuser"])
    return [r.lower() for r in roles]


def has_feature_access(feature: str, role: str) -> bool:
    r = (role or "analyst").strip().lower()
    if role_is_elevated(r) and feature in {"admin"}:
        return True
    return r in set(allowed_roles(feature))


def feature_flags() -> dict[str, bool]:
    return {
        "shadow_analyst": settings.shadow_analyst_enabled,
        "pii_redaction": settings.pii_redaction_enabled,
        "postgres_checkpointer": settings.use_postgres_checkpointer,
    }
