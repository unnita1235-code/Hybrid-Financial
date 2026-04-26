r"""
What-if scenario simulation: LLM → single ``UPDATE`` inside a read-write
transaction, then the validated ``SELECT`` from the SQL engine on the
mutated snapshot, then always ``ROLLBACK``.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal
from functools import lru_cache
from typing import Any, Literal, cast

from fastapi import HTTPException
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from aequitas_ai import (
    DEFAULT_FINANCIAL_SCHEMA,
    SqlGraphConfig,
    build_sql_engine_graph,
)
from aequitas_ai.sql_engine import _is_read_only_select
from app.config import settings
from app.rbac.sensitive_sql import assert_sql_rbac

MUTATION_ARCHITECT = """You are a PostgreSQL mutation planner for scenario simulation
(dry run — the change is rolled back immediately after reads).

The database schema is:
""" + f"""

{DEFAULT_FINANCIAL_SCHEMA}

Output rules (must follow all):
- Respond with a JSON object only, no other text: {{"update_sql": "<one statement or null if impossible>", "rationale": "<one sentence how you mapped the scenario to the schema>"}}.
- ``update_sql`` must be a **single** standard PostgreSQL **UPDATE** statement. No CTE, no multiple statements, no semicolons inside the string except optionally one trailing `;`.
- The UPDATE must be scoped with a **WHERE** clause (never update all rows without a filter).
- Only modify existing columns on ``transactions``, ``market_data`` (or
  ``market_indices`` view), or ``company_filings`` as in the schema.
- Map vague costs (e.g. "material costs up 15%") to numeric columns the schema provides (e.g. scale ``price`` or ``value``) and explain the proxy in **rationale**.
- Use valid PostgreSQL syntax. Prefer bounded windows in WHERE (e.g. ``ts_utc >= now() - interval '1 year'``) when the scenario is time-bound.
- If the scenario cannot be expressed safely, return ``update_sql`` null and explain in **rationale**."""

_MAX_SQL_ROWS = 5_000
_UPDATE_TABLES = frozenset(
    {
        "transactions",
        "market_data",
        "market_indices",  # view over market_data when migration 004 is applied
        "company_filings",
    }
)
_FORBIDDEN_TOKENS = re.compile(
    r"\b(?:insert|delete|drop|alter|create|truncate|merge|copy\s+\w+\s+to|"
    r"execute|grant|revoke|vacuum)\b",
    re.IGNORECASE,
)


def _strip_json_fence(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


@lru_cache
def get_rw_simulation_engine() -> AsyncEngine:
    """No ``default_transaction_read_only`` so UPDATE + SELECT can run in one txn."""
    url = settings.database_url
    if url.startswith("postgresql+asyncpg"):
        return create_async_engine(
            url,
            pool_pre_ping=True,
        )
    return create_async_engine(url, pool_pre_ping=True)


def _update_target_table(sql: str) -> str | None:
    m = re.search(
        r"(?i)\bupdate\s+(?:[a-z0-9_`\"]+\s*\.\s*)?([a-z0-9_`\"]+)\s+set\b",
        sql.strip(),
    )
    if not m:
        return None
    name = m.group(1).strip().strip('"').strip("`").lower()
    return name or None


def _validate_mutation_sql(sql: str) -> None:
    t = sql.strip()
    t_core = t.rstrip(";")
    if not t_core:
        raise HTTPException(status_code=400, detail="Empty UPDATE after generation.")
    if ";" in t_core:
        raise HTTPException(
            status_code=400, detail="Only a single SQL statement is allowed in simulation.",
        )
    if not re.match(r"^\s*update\s+", t_core, re.IGNORECASE | re.DOTALL):
        raise HTTPException(
            status_code=400, detail="Scenario SQL must be a single UPDATE statement.",
        )
    if not re.search(r"\bwhere\b", t_core, re.IGNORECASE):
        raise HTTPException(
            status_code=400, detail="UPDATE must include a WHERE clause for safety.",
        )
    if _FORBIDDEN_TOKENS.search(t_core):
        raise HTTPException(
            status_code=400, detail="Statement contains forbidden SQL operations.",
        )
    table = _update_target_table(t_core)
    if not table or table not in _UPDATE_TABLES:
        raise HTTPException(
            status_code=400,
            detail=f"UPDATE may only target: {', '.join(sorted(_UPDATE_TABLES))}.",
        )


def _llm_pair() -> tuple[ChatOpenAI, ChatOpenAI]:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503, detail="OPENAI_API_KEY is required for scenario simulation."
        )
    c = ChatOpenAI(
        model=settings.sql_model,
        temperature=0,
        api_key=settings.openai_api_key,
    )
    return c, c


@lru_cache
def get_sql_read_graph():
    arch, val = _llm_pair()
    cfg = SqlGraphConfig(
        architect_llm=arch,
        validator_llm=val,
        database_url=settings.database_url,
        max_result_rows=_MAX_SQL_ROWS,
        schema_ddl=DEFAULT_FINANCIAL_SCHEMA,
    )
    return build_sql_engine_graph(cfg)


def _llm_mutation() -> BaseChatModel:
    return _llm_pair()[0]


async def generate_mutation_from_scenario(what_if: str) -> tuple[str, str]:
    """LLM: natural language what-if -> UPDATE + rationale."""
    llm = _llm_mutation()
    msg = [
        SystemMessage(content=MUTATION_ARCHITECT),
        HumanMessage(
            content=f"Scenario to simulate (hypothetical, rolled back after reads):\n{what_if}\n"
        ),
    ]
    res = await llm.ainvoke(msg)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    payload = _strip_json_fence(str(raw))
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502, detail=f"Mutation model returned invalid JSON: {e}"
        ) from e
    usql = data.get("update_sql")
    rationale = str(data.get("rationale", ""))
    if usql is not None and not isinstance(usql, str):
        raise HTTPException(status_code=502, detail="Mutation model returned non-string update_sql.")
    if not usql or not str(usql).strip():
        raise HTTPException(
            status_code=400,
            detail=rationale or "Could not map the scenario to a safe UPDATE.",
        )
    u = str(usql).strip()
    _validate_mutation_sql(u)
    return u, rationale


async def get_validated_select_sql(insight_query: str) -> str:
    """Run the read-only SQL agent graph; return validated inner SELECT (no subquery wrap)."""
    g = get_sql_read_graph()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503, detail="OPENAI_API_KEY is required for the SQL agent."
        )
    out: dict[str, Any] = await g.ainvoke(
        {
            "user_query": insight_query,
            "retry_count": 0,
            "generated_sql": None,
            "error_message": None,
        }
    )
    err = out.get("error_message")
    gen = (out.get("generated_sql") or "").strip()
    if not gen and err:
        raise HTTPException(
            status_code=400, detail=f"SQL agent failed: {err}",
        )
    if not gen or not _is_read_only_select(gen):
        msg = out.get("validation_feedback") or err or "No valid read-only SQL produced."
        raise HTTPException(
            status_code=400, detail=f"Invalid or empty SELECT: {msg}",
        )
    return gen


def _wrap_limited_subquery(sql: str) -> str:
    inner = sql.strip().rstrip(";")
    return f"SELECT * FROM ({inner}) AS _aequitas_sim_subq LIMIT {_MAX_SQL_ROWS}"


def _is_numeric(v: Any) -> bool:
    if isinstance(v, bool) or v is None:
        return False
    if isinstance(v, (int, float, Decimal)):
        return True
    return False


def _as_float(v: Any) -> float:
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def _json_safe_rows(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in raw:
        item: dict[str, Any] = {}
        for k, v in row.items():
            if isinstance(v, Decimal):
                item[k] = float(v)
            else:
                item[k] = v
        out.append(item)
    return out


def _heuristic_label_format(rows: list[dict[str, Any]]) -> tuple[float, str, Literal["currency", "percent", "number"]]:
    if not rows:
        return 0.0, "Result", "number"
    first = rows[0]
    num_key: str | None = None
    value = 0.0
    for k, v in first.items():
        if _is_numeric(v):
            num_key = k
            value = _as_float(v)
            break
    label = f"{num_key}" if num_key else "Metric"
    if num_key and (
        "pct" in num_key.lower()
        or "percent" in num_key.lower()
        or "yoy" in num_key.lower()
    ):
        fmt: Literal["currency", "percent", "number"] = "percent"
    elif num_key and any(
        s in num_key.lower() for s in ("rev", "price", "value", "sum", "amount", "usd")
    ):
        fmt = "currency"
    else:
        fmt = "number"
    return value, label, fmt


def _heuristic_chart(rows: list[dict[str, Any]]) -> list[dict[str, str | float]]:
    if len(rows) < 2:
        return []
    # Prefer two columns: label-like + number
    keys = list(rows[0].keys())
    if len(keys) < 2:
        return []
    t_key, v_key = keys[0], keys[1]
    out: list[dict[str, str | float]] = []
    for row in rows:
        tv, vv = row.get(t_key), row.get(v_key)
        t_str = str(tv) if tv is not None else ""
        if _is_numeric(vv):
            out.append({"t": t_str, "v": _as_float(vv)})
    return out if len(out) >= 2 else []


class ScenarioSimulationResult(BaseModel):
    value: float
    label: str
    format: Literal["currency", "percent", "number"]
    sql: str
    rows: list[dict[str, Any]] = Field(default_factory=list)
    chart: list[dict[str, str | float]] = Field(default_factory=list)
    update_sql: str
    update_rationale: str


async def run_scenario_simulation(
    *,
    what_if: str,
    insight_query: str,
    user_role: str,
) -> ScenarioSimulationResult:
    """
    1) SQL agent: NL → read-only ``SELECT`` (validates on a read connection).
    2) LLM: ``what_if`` → ``UPDATE`` with static safety checks.
    3) RBAC on both statements.
    4) RW transaction: **UPDATE** then **SELECT**; **ROLLBACK** always.
    """
    w = (what_if or "").strip()
    q = (insight_query or "").strip()
    if not w:
        raise HTTPException(status_code=400, detail="what_if (scenario) is required.")
    if not q:
        raise HTTPException(status_code=400, detail="insight_query is required.")

    select_sql = await get_validated_select_sql(q)
    update_sql, rationale = await generate_mutation_from_scenario(w)

    assert_sql_rbac(select_sql, user_role)
    assert_sql_rbac(update_sql, user_role)

    eng = get_rw_simulation_engine()
    limited = _wrap_limited_subquery(select_sql)
    sim_rows: list[dict[str, Any]] = []

    async with eng.connect() as conn:
        trans = await conn.begin()
        try:
            await conn.execute(text(update_sql))
            res = await conn.execute(text(limited))
            sim_rows = _json_safe_rows(
                [dict(r) for r in res.mappings().all()]
            )
        except HTTPException:
            await trans.rollback()
            raise
        except Exception as e:  # noqa: BLE001
            await trans.rollback()
            raise HTTPException(
                status_code=502,
                detail=f"Scenario execution failed: {e!s}. Transaction rolled back.",
            ) from e
        else:
            await trans.rollback()

    value, label, fmt = _heuristic_label_format(sim_rows)
    chart = _heuristic_chart(sim_rows)

    return ScenarioSimulationResult(
        value=value,
        label=label,
        format=cast(Literal["currency", "percent", "number"], fmt),
        sql=select_sql,
        rows=sim_rows,
        chart=chart,
        update_sql=update_sql,
        update_rationale=rationale,
    )
