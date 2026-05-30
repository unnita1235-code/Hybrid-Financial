"""Tests for RRF merge logic — pure math, no network, no env vars."""
import pytest
from aequitas_ai.rag_engine import merge_rrf


def test_rrf_item_in_both_lists_scores_higher():
    list_a = [{"id": "A", "content": "x"}, {"id": "B", "content": "y"}]
    list_b = [{"id": "A", "content": "x"}, {"id": "C", "content": "z"}]
    merged = merge_rrf(list_a, list_b, k=60)
    ids = [item["id"] for item in merged]
    # A is rank 1 in both lists, so it must be first
    assert ids[0] == "A"


def test_rrf_preserves_all_unique_items():
    list_a = [{"id": "A"}, {"id": "B"}]
    list_b = [{"id": "C"}, {"id": "D"}]
    merged = merge_rrf(list_a, list_b, k=60)
    ids = {item["id"] for item in merged}
    assert ids == {"A", "B", "C", "D"}


def test_rrf_empty_one_list():
    list_a = [{"id": "A"}, {"id": "B"}]
    list_b = []
    merged = merge_rrf(list_a, list_b, k=60)
    assert len(merged) == 2
    assert merged[0]["id"] == "A"
