r"""
LangGraph SQL generation pipeline: Architect → Validator → (retry) | Execution.

# Internal logic (read-only / retry)
#
# We cap architect attempts with a retry budget. Let
#   $$K = 2$$
# be the total number of architect invocations, and
#   $$r \in \{0,1\}$$
# the ``retry_count`` after ``retry_prep`` (so
#   $$r=0 \Rightarrow$$
# first attempt, and
#   $$r=1 \Rightarrow$$
# a single follow-up). The routing rule after validation is
#   $$\text{route} = \begin{cases}
#   \text{execute} & \text{if } v=\text{true} \\
#   \text{retry\_prep} & \text{if } v=\text{false} \land r<1 \\
#   \text{end} & \text{if } v=\text{false} \land r\ge 1
#   \end{cases}$$
# where $v$ is ``is_valid`` from the Validator node.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal, NotRequired, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

# --- Schema: transactions, market_data, company_filings (see Alembic migrations) ---

DEFAULT_FINANCIAL_SCHEMA = """
-- Logical schema (PostgreSQL) for the Architect. Matches migrations in
-- ``packages/database`` (``transactions``, ``market_data``). A view
-- ``market_indices`` (migration 004) aliases ``market_data`` with ``metadata`` for
-- ``chunk_metadata`` for backward compatibility.

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY,
  company_id      UUID,                   -- company scope for joins (nullable in DB)
  symbol          TEXT NOT NULL,          -- e.g. 'AAPL'
  ts_utc          TIMESTAMPTZ NOT NULL,   -- trade/settlement time
  price           NUMERIC(18,6) NOT NULL,
  volume          NUMERIC(24,6) NOT NULL,
  buy_sell        TEXT,                   -- 'B','S', or NULL
);

CREATE TABLE IF NOT EXISTS market_data (
  id            UUID PRIMARY KEY,
  as_of_utc     TIMESTAMPTZ NOT NULL,     -- official observation time
  code          TEXT NOT NULL,           -- e.g. 'SPX', 'RUT'
  value         NUMERIC(24,8) NOT NULL,   -- index level
  return_1d     NUMERIC(18,10),         -- prior-day total return, if any
  chunk_metadata JSONB
);

-- Optional view (if migration applied): same rows as market_data, column "metadata" = chunk_metadata.
-- CREATE OR REPLACE VIEW market_indices AS ... ;

-- Filings: join to a company by company_id; metadata stores form type, accession, etc.
CREATE TABLE IF NOT EXISTS company_filings (
  id            UUID PRIMARY KEY,
  company_id    UUID NOT NULL,
  period_end    DATE,                     -- reporting period
  form_type     TEXT,                     -- '10-K', '10-Q', '8-K', ...
  filed_at_utc  TIMESTAMPTZ,
  cik           TEXT,                     -- optional external id
  accession     TEXT,                     -- optional EDGAR accession
  text_excerpt  TEXT,                     -- short excerpt, not full filing
  metadata      JSONB
);

-- Valid join hints (no FK enforced in DB, but lints should assume):
--   join transactions.company_id to company_filings.company_id; join
--   market_data (or market_indices view) by code and as_of_utc to align series
"""

# --- System prompts (Architect: NL → SQL) ---

ARCHITECT_SYSTEM = """You are a PostgreSQL query architect for Aequitas FI.

Rules (must follow all):
- Output a single, read-only SQL statement: SELECT or WITH...SELECT. No DML/DDL.
- Use only the tables and columns in the provided schema. Prefer explicit JOIN...ON
  with equality predicates on the documented keys (e.g. company_id).
- Qualify table names. Use clear aliases (t, m, f) when joining.
- If the user question is ambiguous, choose the most conservative, minimal query.
- Respond with a JSON object only, no commentary:
  { "sql": "<single postgres statement or null if impossible>", "rationale": "<one sentence>" }"""

# --- System prompts (Validator: lint) ---

VALIDATOR_SYSTEM = """You are a strict PostgreSQL query linter. You are given a single
SQL string that must be read-only: SELECT/CTE only.

Check:
- Syntax: balanced parentheses, valid PostgreSQL, single statement, trailing semicolons
  may exist but the statement must be one top-level read query.
- Forbidden: DROP, DELETE, TRUNCATE, UPDATE, INSERT, MERGE, ALTER, CREATE, GRANT,
  REVOKE, COPY ... TO, EXECUTE, or other mutating/DDL commands (case-insensitive).
- Joins: every JOIN must be ON a plausible key from the schema; flag joins on columns
  that do not exist or pair unrelated types.

Respond with JSON only:
{ "valid": <true|false>, "issues": [ "<string>", ... ] }"""


class SqlEngineState(TypedDict, total=False):
    """
    State for the SQL LangGraph.

    The pipeline tracks ``user_query``, ``generated_sql``, ``error_message``,
    and ``retry_count``; optional keys support validation and result rows.
    """

    user_query: str
    generated_sql: str | None
    error_message: str | None
    retry_count: int
    is_valid: NotRequired[bool]
    validation_details: NotRequired[str | None]
    validation_feedback: NotRequired[str | None]
    sql_rows: NotRequired[list[dict[str, Any]] | None]


class SqlGraphConfig(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=False)

    architect_llm: BaseChatModel
    validator_llm: BaseChatModel
    database_url: str
    max_result_rows: int = Field(default=5_000, ge=1, le=1_000_000)
    schema_ddl: str = Field(default=DEFAULT_FINANCIAL_SCHEMA)
    # Optional: caller-supplied read-only engine (e.g. shared pool; caller disposes)
    async_engine: AsyncEngine | None = Field(default=None, exclude=True, repr=False)

    @property
    def engine(self) -> AsyncEngine:
        if self.async_engine is not None:
            return self.async_engine
        return _create_readonly_async_engine(self.database_url)


# --- Read-only connection -------------------------------------------------


def _create_readonly_async_engine(url: str) -> AsyncEngine:
    if url.startswith("postgresql+asyncpg"):
        return create_async_engine(
            url,
            pool_pre_ping=True,
            connect_args={"server_settings": {"default_transaction_read_only": "on"}},
        )
    return create_async_engine(url, pool_pre_ping=True)


_FORBIDDEN_SQL = re.compile(
    r"\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|MERGE|ALTER|CREATE|GRANT|REVOKE|"
    r"VACUUM|CALL|EXPLAIN\s+ANALYZE|COPY\s+.*\s+TO|EXEC(UTE)?)\b",
    re.IGNORECASE | re.DOTALL,
)


def _is_read_only_select(sql: str) -> bool:
    s = sql.strip()
    if not s or _FORBIDDEN_SQL.search(s):
        return False
    s_norm = s.rstrip(";")
    if ";" in s_norm:
        return False
    return bool(re.match(r"^\s*(WITH|SELECT)\b", s_norm, re.IGNORECASE | re.DOTALL))


# --- LLM I/O ----------------------------------------------------------------


def _strip_json_fence(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


async def _architect_ainvoke(
    config: SqlGraphConfig,
    user_query: str,
    prior_feedback: str | None,
) -> tuple[str | None, str]:
    user_block = f"User question:\n{user_query}\n"
    if prior_feedback:
        user_block += (
            f"\nPrevious validator output (fix the SQL accordingly):\n{prior_feedback}\n"
        )
    user_block += f"\nSchema:\n{config.schema_ddl}\n"
    msg = [
        SystemMessage(content=ARCHITECT_SYSTEM),
        HumanMessage(content=user_block),
    ]
    res = await config.architect_llm.ainvoke(msg)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    payload = _strip_json_fence(str(raw))
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None, "Architect returned non-JSON output."
    sql = data.get("sql")
    rationale = str(data.get("rationale", ""))
    if sql is not None and not isinstance(sql, str):
        return None, rationale
    if sql and not _is_read_only_select(sql):
        return None, (
            rationale + " (generated SQL was not a single read-only SELECT/CTE.)"
        )
    return (sql, rationale)


async def _validator_ainvoke(
    config: SqlGraphConfig, sql: str, schema: str
) -> tuple[bool, str]:
    human = f"Schema (reference):\n{schema}\n\nSQL to validate:\n{sql}\n"
    msg = [SystemMessage(content=VALIDATOR_SYSTEM), HumanMessage(content=human)]
    res = await config.validator_llm.ainvoke(msg)
    raw = getattr(res, "content", res)
    if isinstance(raw, list):
        raw = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
        )
    payload = _strip_json_fence(str(raw))
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return False, "Validator returned non-JSON output (treat as invalid SQL)."
    valid = bool(data.get("valid"))
    issues = data.get("issues")
    if issues is not None and not isinstance(issues, list):
        issues = [str(issues)]
    line = " | ".join(str(i) for i in (issues or [])) if not valid else ""
    return valid, line


# --- Graph nodes ----------------------------------------------------------


@dataclass
class NodeBundle:
    config: SqlGraphConfig


def _make_architect(b: NodeBundle):
    async def architect(state: SqlEngineState) -> dict[str, Any]:
        prior = state.get("validation_feedback")
        sql, _r = await _architect_ainvoke(
            b.config,
            state.get("user_query", ""),
            prior,
        )
        return {
            "generated_sql": sql,
            "is_valid": False,
        }

    return architect


def _make_validator(b: NodeBundle):
    async def validator(state: SqlEngineState) -> dict[str, Any]:
        q = (state.get("generated_sql") or "").strip()
        if not q:
            return {
                "is_valid": False,
                "error_message": None,
                "validation_details": "empty",
                "validation_feedback": "The Architect did not return executable SQL.",
            }
        if not _is_read_only_select(q):
            return {
                "is_valid": False,
                "error_message": None,
                "validation_details": "forbidden or multi-statement",
                "validation_feedback": "The SQL is not a single read-only SELECT/CTE.",
            }
        ok, issues = await _validator_ainvoke(b.config, q, b.config.schema_ddl)
        if ok:
            return {
                "is_valid": True,
                "error_message": None,
                "validation_details": "ok",
                "validation_feedback": None,
            }
        return {
            "is_valid": False,
            "error_message": None,
            "validation_details": issues,
            "validation_feedback": issues,
        }

    return validator


def _make_retry_prep():
    def retry_prep(state: SqlEngineState) -> dict[str, Any]:
        # $$r' = r + 1$$ with $r$ the current ``retry_count``.
        r0 = int(state.get("retry_count", 0))
        return {
            "retry_count": r0 + 1,
        }

    return retry_prep


def _make_execute(b: NodeBundle):
    async def execute(state: SqlEngineState) -> dict[str, Any]:
        eng = b.config.engine
        sql = (state.get("generated_sql") or "").strip()
        if not _is_read_only_select(sql):
            return {
                "error_message": "Refusing to run non read-only SQL.",
                "sql_rows": None,
            }
        limited = (
            f"SELECT * FROM ({sql}) AS _aequitas_subq LIMIT {b.config.max_result_rows}"
        )
        try:
            async with eng.connect() as conn:
                res = await conn.execute(text(limited))
                m = res.mappings().all()
                rows = [dict(r) for r in m]
        except Exception as e:
            return {
                "error_message": f"Execution error: {e!s}",
                "sql_rows": None,
            }
        return {
            "error_message": None,
            "sql_rows": rows,
        }

    return execute


def route_after_validation(
    state: SqlEngineState,
) -> Literal["execute", "retry_prep", "end"]:
    if state.get("is_valid"):
        return "execute"
    r = int(state.get("retry_count", 0))
    if r < 1:
        return "retry_prep"
    return "end"


def _make_terminalize_failure():
    def terminalize(state: SqlEngineState) -> dict[str, Any]:
        err = state.get("validation_feedback") or state.get("error_message")
        if not err:
            err = state.get("validation_details")
        return {
            "error_message": str(err) if err else "Validation failed after allowed retries.",
        }

    return terminalize


def build_sql_engine_graph(config: SqlGraphConfig):
    """
    Build the compiled graph. Start from ``START``; invoke, for example,
    await ``graph.ainvoke`` with
    ``{"user_query": "...", "retry_count": 0, "generated_sql": None,
    "error_message": None}``.
    """
    b = NodeBundle(config=config)
    g = StateGraph(SqlEngineState)
    g.add_node("architect", _make_architect(b))
    g.add_node("validator", _make_validator(b))
    g.add_node("retry_prep", _make_retry_prep())
    g.add_node("execute", _make_execute(b))
    g.add_node("end_fail", _make_terminalize_failure())

    g.add_edge(START, "architect")
    g.add_edge("architect", "validator")
    g.add_conditional_edges(
        "validator",
        route_after_validation,
        {
            "execute": "execute",
            "retry_prep": "retry_prep",
            "end": "end_fail",
        },
    )
    g.add_edge("retry_prep", "architect")
    g.add_edge("execute", END)
    g.add_edge("end_fail", END)

    return g.compile()
