#!/usr/bin/env python3
"""
Fail if **tracked** repository files match high-confidence patterns for
OpenAI or **Anthropic** API keys. Intended for CI; never prints matched secret text.

Excludes: ``.git``, ``.png``, large binaries, and ``*.lock`` by default.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

# OpenAI: project keys, legacy sk- (length heuristic). Anthropic: sk-ant-*
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"sk-proj-[a-zA-Z0-9_-]{20,}"), "OpenAI (sk-proj-…)"),
    (
        re.compile(r"sk-(?!ant)[a-zA-Z0-9]{20,}"),
        "OpenAI-style (sk-…; exclude sk-ant-)",
    ),
    (re.compile(r"sk-ant-api[0-9-]*-[\w-]{20,}"), "Anthropic (sk-ant-…)"),
)

TEXT_SUFFIX = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".json",
    ".yml",
    ".yaml",
    ".md",
    ".toml",
    ".env",
    ".example",
    ".txt",
    ".sh",
    ".ps1",
    ".css",
    ".html",
    ".svg",
}
SKIP_GLOBS = ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb")
MAX_BYTES = 512_000


def _git_ls_files(root: Path) -> list[Path]:
    r = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True,
        text=False,
        check=False,
    )
    if r.returncode != 0 or not r.stdout:
        if os.environ.get("CI", "").lower() in ("1", "true", "yes"):
            print("git ls-files failed in CI; cannot scan for API keys.", file=sys.stderr)
            raise SystemExit(1)
        print(
            "Not a git repo or git missing; key scan skipped (use repo root in CI).",
            file=sys.stderr,
        )
        return []
    out: list[Path] = []
    for part in r.stdout.split(b"\0"):
        if not part:
            continue
        rel = part.decode("utf-8", errors="replace")
        if any(s in rel.replace("\\", "/") for s in SKIP_GLOBS):
            continue
        out.append(root / rel)
    return out


def _is_probably_text(path: Path) -> bool:
    suf = path.suffix.lower()
    if suf in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".eot", ".ttf", ".otf", ".zip", ".pdf", ".pyc", ".so", ".dll", ".exe"):
        return False
    if path.name.startswith("."):
        return True
    return suf in TEXT_SUFFIX or suf == "" or ".env" in path.name


def scan(root: Path | None = None) -> list[tuple[str, str, int]]:
    """Return list of (file_display, reason, line_no)."""
    root = (root or Path(__file__).resolve().parents[1])
    issues: list[tuple[str, str, int]] = []
    for f in _git_ls_files(root):
        try:
            rel = f.relative_to(root)
        except ValueError:
            rel = f
        if not f.is_file() or not _is_probably_text(f):
            continue
        try:
            data = f.read_bytes()
        except OSError:
            continue
        if len(data) > MAX_BYTES:
            data = data[:MAX_BYTES]
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("utf-8", errors="replace")
        for i, line in enumerate(text.splitlines(), 1):
            for rx, name in _PATTERNS:
                m = rx.search(line)
                if m:
                    # allow obvious placeholders: sk-**** or sk-REDACTED
                    s = m.group(0)
                    if "****" in line or "REDACT" in line.upper() or "YOUR_" in line or "<" in s:
                        continue
                    if s.startswith("sk-") and len(s) < 32 and "example" in line.lower():
                        continue
                    issues.append((str(rel), name, i))
                    break
    return issues


def main() -> int:
    bad = scan()
    if bad:
        print("API key–like patterns in tracked files (do not commit secrets):", file=sys.stderr)
        for path, reason, line in bad:
            print(f"  {path}:{line} ({reason})", file=sys.stderr)
        return 1
    print("No OpenAI/Anthropic key patterns matched in tracked text files.", file=sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
