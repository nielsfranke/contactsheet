#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Print the CHANGELOG.md section body for a version, e.g. `changelog-extract.py 1.0.3`.

Used by CI to turn the hand-written changelog entry into release notes. Emits the text
between the `## [VERSION]` heading and the next `## [` heading; falls back to a stub if the
version isn't found.
"""
import re
import sys
from pathlib import Path


def extract(version: str, text: str) -> str:
    version = version.lstrip("v")
    m = re.search(
        r"^## \[" + re.escape(version) + r"\][^\n]*\n(.*?)(?=^## \[|\Z)",
        text,
        re.S | re.M,
    )
    body = m.group(1).strip() if m else ""
    return body or f"Release {version}."


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: changelog-extract.py <version>")
    changelog = Path(__file__).resolve().parent.parent / "CHANGELOG.md"
    print(extract(sys.argv[1], changelog.read_text(encoding="utf-8")))


if __name__ == "__main__":
    main()
