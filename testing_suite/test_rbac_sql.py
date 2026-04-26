"""RBAC: executive table references blocked for non-elevated roles."""

import pytest
from fastapi import HTTPException

from app.rbac.sensitive_sql import assert_sql_rbac, role_is_elevated


def test_executive_allows_salaries_for_executive() -> None:
    assert_sql_rbac("select * from salaries s", "executive")
    assert_sql_rbac("select * from m_and_a_plans", "admin")


def test_executive_blocks_analyst() -> None:
    with pytest.raises(HTTPException) as e:
        assert_sql_rbac("select * from salaries", "analyst")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        assert_sql_rbac("select 1 from public.salaries", "analyst")


def test_transactions_unrestricted() -> None:
    assert_sql_rbac(
        "SELECT * FROM transactions t JOIN market_data m ON 1=1", "analyst"
    )


def test_role_elevated() -> None:
    assert role_is_elevated("executive") is True
    assert role_is_elevated("analyst") is False
