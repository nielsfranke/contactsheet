#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Regenerate the documentation screenshots end-to-end: seed an isolated demo instance, then
# capture all 12 scenes into docs/screenshots/. Runs on ports 8099/3099 against demo/.data, so
# it never touches a developer's live instance on :8000/:3000.
#
# Usage:  bash demo/run.sh            (assumes demo/assets/ already populated)
#         bash demo/run.sh --fetch    (also re-download the CC0 photo pool first)
set -euo pipefail
cd "$(dirname "$0")/.."
PY="backend/.venv/bin/python"

if [[ "${1:-}" == "--fetch" ]]; then
  "$PY" demo/fetch_assets.py
  "$PY" demo/select_assets.py
fi

"$PY" demo/seed_demo.py
"$PY" demo/capture_screenshots.py
echo "Done — see docs/screenshots/"
