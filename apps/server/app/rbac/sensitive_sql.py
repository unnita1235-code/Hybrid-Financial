r"""
Block read-only SQL that touches *executive* tables for non-executive roles.
Matches table names in FROM / JOIN; case-insensitive, word-boundary safe enough for prod guardrails.
"""

from __future__ import annotations

import re

from app.config import settings

# Tables that require an executive (or admin) role to query.
_DEFAULT_EXEC_TABLES: frozenset[str] = frozenset({"salaries", "m_and_a_plans"})


def _table_list() -> set[str]:
    raw = (settings.rbac_executive_tables or "").strip()
    if not raw:
        return set(_DEFAULT_EXEC_TABLES)
    return {p.strip().lower() for p in raw.split(",") if p.strip()}


def _strip_quotes(s: str) -> str:
    t = s.strip()
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("`") and t.endswith("`")):
        return t[1:-1]
    return t


def _referenced_tables(sql: str | None) -> set[str]:
    if not sql or not str(sql).strip():
        return set()
    s = str(sql)
    out: set[str] = set()
    for m in re.finditer(
        r"(?i)(?:\bfrom|\bjoin)\s+([a-z0-9_`]+)\.([a-z0-9_`]+)",
        s,
    ):
        out.add(_strip_quotes(m.group(2)).lower())
    for m in re.finditer(
        r"(?i)\bupdate\s+(?:[a-z0-9_`\"]+\s*\.\s*)?([a-z0-9_`\"]+)\s+set\b",
        s,
    ):
        tname = _strip_quotes(m.group(1)).lower()
        if tname:
            out.add(tname)
    for m in re.finditer(
        r'(?i)(?:\bfrom|\bjoin)\s+("?)([a-z0-9_`]+)(?:\1|)(?!\.\w)',
        s,
    ):
        name = _strip_quotes(m.group(2)).lower()
        if not name or name in ("lateral", "select", "on", "as", "using"):
            continue
        if name in (
            "inner",
            "outer",
            "left",
            "right",
            "full",
            "cross",
            "where",
        ):
            continue
        out.add(name)
    return out


def role_is_elevated(role: str) -> bool:
    r = (role or "analyst").lower().strip()
    allowed = {x.strip().lower() for x in (settings.rbac_elevated_roles or "").split(",") if x.strip()}
    if not allowed:
        allowed = {"executive", "admin", "superuser"}
    return r in allowed


def assert_sql_rbac(
    generated_sql: str | None,
    user_role: str,
) -> None:
    from fastapi import HTTPException

    tables = _referenced_tables(generated_sql)
    exec_needing = tables & _table_list()
    if not exec_needing:
        return
    if role_is_elevated(user_role):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            "This query would access executive-only tables "
            f"({', '.join(sorted(exec_needing))}). "
            "Request access with an executive or admin role (Clerk / Supabase / RBAC)."
        ),
    )
