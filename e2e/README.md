<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# End-to-end tests

A Playwright smoke test that drives the **core photographer→client journey** through a
real browser against a **real backend + frontend** — the layer the `backend/tests/`
unit suite (TestClient, no browser) and the frontend Vitest unit tests can't reach.

The one spec (`test_core_loop.py`) covers: setup wizard → admin login → create gallery
→ upload a photo → wait for processing → open the share link as a client → the gallery
renders + the thumbnail serves → client flags + comments → client downloads the ZIP.

## How it runs

`conftest.py` boots an **isolated, ephemeral** stack so it never touches your dev stack
(`:3000`/`:8000`) or your `data/` dir:

1. A temp data dir + `alembic upgrade head`, then `uvicorn` on a random free port.
2. `next build` + `next start` on another random port, with `NEXT_PUBLIC_API_BASE`
   pointed at the ephemeral backend (the `next.config.ts` rewrites proxy `/api` +
   `/uploads` there — same routing nginx does in prod, minus nginx). The env must be
   set on the **build**: rewrite destinations are baked into `routes-manifest.json`
   at build time; `next start` ignores it, so a prebuilt `.next` can't be repointed.

Auth + the public gallery render go through the browser UI; the data steps use
Playwright's request context (shares the browser cookie, still real HTTP through the
Next rewrite).

## Running locally

From the repo root, using the backend venv's interpreter (it has `pytest-playwright`):

```bash
# one-time: install the test deps + the browser
backend/.venv/bin/pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m playwright install chromium

# run (the -o addopts="" overrides backend/pytest.ini's -q if you want more output)
backend/.venv/bin/pytest e2e/
```

The first run is slower because it builds the frontend. To watch the browser, add
`--headed` (and `--slowmo 500`).

## Notes / caveats

- Uses **random free ports**, so it's safe to run while the dev servers are up.
- `next start` (not `next dev`) is deliberate — the Next dev server is a per-project
  daemon that would ignore our port/env (see the local-dev notes).
- CI runs this via `.github/workflows/tests.yml` (`pytest e2e/`), after
  `playwright install --with-deps chromium`.
