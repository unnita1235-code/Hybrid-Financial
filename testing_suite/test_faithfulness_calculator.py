import pytest

from testing_suite.calculate_faithfulness import faithfulness_score


def test_faithfulness_half_overlap():
    claims = {"a", "b", "c"}
    evidence = {"a", "x"}
    assert faithfulness_score(claims, evidence) == pytest.approx(1 / 3)


def test_faithfulness_full():
    c = {"only"}
    assert faithfulness_score(c, {"only"}) == 1.0


def test_faithfulness_empty_claims():
    assert faithfulness_score(set(), {"x"}) == 0.0
