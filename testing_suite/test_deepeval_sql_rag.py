"""
DeepEval: **SQL Correctness** (G-Eval on generated SQL) and **RAG Faithfulness**
(Faithfulness metric). Uses the default OpenAI-based judge; set
``OPENAI_API_KEY`` in the environment. If the key is missing, this module
skips at import time. If ``deepeval`` is not installed, skip with a clear
message (install :file:`testing_suite/requirements.txt`).
"""

from __future__ import annotations

import os

import pytest

try:
    from deepeval import assert_test
    from deepeval.metrics import FaithfulnessMetric, GEval
    from deepeval.test_case import LLMTestCase, LLMTestCaseParams
except ImportError as e:  # pragma: no cover
    assert_test = None  # type: ignore[assignment, misc]
    FaithfulnessMetric = GEval = None  # type: ignore[assignment, misc]
    LLMTestCase = LLMTestCaseParams = None  # type: ignore[assignment, misc]
    _IMPORT_ERR = e
else:
    _IMPORT_ERR = None

if _IMPORT_ERR is not None:
    pytest.skip(
        f"deepeval not available: {_IMPORT_ERR}. "
        f"Install: pip install -r testing_suite/requirements.txt",
        allow_module_level=True,
    )
if not os.getenv("OPENAI_API_KEY"):
    pytest.skip(
        "Set OPENAI_API_KEY for DeepEval LLM-judge metrics (e.g. GitHub Actions secret).",
        allow_module_level=True,
    )


@pytest.mark.requires_llm
def test_deepeval_sql_correctness_g_eval() -> None:
    assert assert_test and GEval and LLMTestCase and LLMTestCaseParams
    m = GEval(
        name="SQL Correctness",
        criteria=(
            "The 'actual output' is a single read-only SQL statement: only "
            "SELECT and/or WITH...SELECT, no DML/DDL, no multiple statements, "
            "syntactically plausible for PostgreSQL. Score 1 if yes, 0 if not."
        ),
        evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=0.5,
    )
    tc = LLMTestCase(
        input="Sum revenue TTM for symbol AAPL from transactions",
        actual_output="SELECT coalesce(SUM(t.price * t.volume),0) AS rev "
        "FROM transactions t "
        "WHERE t.symbol = 'AAPL' AND t.ts_utc >= now() - interval '1 year';",
    )
    assert_test(tc, [m])


@pytest.mark.requires_llm
def test_deepeval_rag_faithfulness_metric() -> None:
    assert assert_test and FaithfulnessMetric and LLMTestCase
    metric = FaithfulnessMetric(threshold=0.85)
    tc = LLMTestCase(
        input="What explains margin pressure in Q3?",
        actual_output="Management cited headwinds from supply chain and input costs in the Q3 call.",
        retrieval_context=[
            "Q3 2024 earnings call: we experienced supply chain headwinds and higher input costs, margin compressed.",
        ],
    )
    assert_test(tc, [metric])


@pytest.mark.requires_llm
def test_faithfulness_negative_case():
    """A response with an unsupported claim should score below 0.85."""
    metric = FaithfulnessMetric(threshold=0.85)
    test_case = LLMTestCase(
        input="What was Q3 revenue?",
        actual_output="Q3 revenue was $5M and the CEO resigned.",
        retrieval_context=["Q3 revenue was $5M."],
    )
    metric.measure(test_case)
    assert metric.score < 0.85, (
        f"Negative case should fail faithfulness but scored {metric.score}"
    )


@pytest.mark.requires_llm
def test_dml_guard_rejects_delete():
    """SQL output containing DML must fail the read-only criteria."""
    from deepeval.metrics import GEval
    metric = GEval(
        name="sql_readonly",
        criteria="Output must be a read-only SELECT statement only",
        threshold=0.5,
    )
    test_case = LLMTestCase(
        input="delete all transactions",
        actual_output="DELETE FROM transactions",
    )
    with pytest.raises(AssertionError):
        assert_test(test_case, [metric])
