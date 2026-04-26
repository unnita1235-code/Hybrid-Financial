#!/usr/bin/env python3
r"""
Set-based **Faithfulness** for explicit claim--evidence alignment.

# Definition

\[
\mathrm{Faithfulness}
= \frac{|\text{Claims} \cap \text{Evidence}|}{|\text{Claims}|}
\]

* \(\text{Claims}\): set of atomic statements extracted from a model output (e.g. normalized strings).
* \(\text{Evidence}\): set of strings from retrieved context the answer may cite.
* If \(|\text{Claims}|=0\), the score is **0.0** (define no-claims case explicitly).

This is a **set-overlap** proxy; for LLM-based faithfulness, see also
``deepeval.metrics.FaithfulnessMetric`` in :mod:`testing_suite.test_deepeval`.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def faithfulness_score(claims: set[str], evidence: set[str]) -> float:
    r"""
    Return :math:`|\text{Claims} \cap \text{Evidence}| / |\text{Claims}|` when
    ``claims`` is non-empty; else ``0.0`` (not LaTeX rendered here; see module docstring).
    """
    if not claims:
        return 0.0
    inter = len(claims & evidence)
    return inter / len(claims)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Compute set-overlap faithfulness: |Claims ∩ Evidence| / |Claims|.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Read one JSON object from stdin: claims and evidence are string arrays",
    )
    p.add_argument(
        "--demo",
        action="store_true",
        help="Print a small example to stdout and exit 0",
    )
    args = p.parse_args(argv)

    if args.demo:
        c = {"revenue down", "margin stable"}
        e = {"revenue down", "other"}
        s = faithfulness_score(c, e)
        print(f"claims={c!r}\nevidence={e!r}\nscore={s:.4f} (expect 0.5)")
        return 0

    if args.json:
        raw = json.load(sys.stdin)
        if not isinstance(raw, dict):
            print("Input must be a JSON object", file=sys.stderr)
            return 2
        cl = raw.get("claims", [])
        ev = raw.get("evidence", [])
        if not isinstance(cl, list) or not isinstance(ev, list):
            print("claims and evidence must be JSON arrays of strings", file=sys.stderr)
            return 2
        score = faithfulness_score(set(map(str, cl)), set(map(str, ev)))
        print(json.dumps({"faithfulness": score, "n_claims": len(cl), "n_evidence": len(ev)}))
        return 0

    p.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
