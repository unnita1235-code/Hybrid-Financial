"""Unit tests for temporal agent helpers (no LLM or DB)."""

from aequitas_ai import filter_chunks_by_metadata_window


def test_filter_chunks_by_metadata_window_inclusive():
    chunks = [
        {"metadata": {"timestamp": "2026-04-15"}},
        {"metadata": {"timestamp": "2026-10-01"}},
    ]
    out = filter_chunks_by_metadata_window(
        chunks, "2026-04-01", "2026-09-30"
    )
    assert len(out) == 1
    assert out[0]["metadata"]["timestamp"] == "2026-04-15"


def test_filter_reversed_start_end_still_inclusive():
    """Start/end are normalized to min/max if passed reversed."""
    chunks = [{"metadata": {"timestamp": "2026-05-01"}}]
    out = filter_chunks_by_metadata_window(
        chunks, "2026-09-30", "2026-04-01"
    )
    assert len(out) == 1
