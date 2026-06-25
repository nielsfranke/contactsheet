<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# End-to-end smoke tests + test CI

**Status:** implemented (2026-06-25) on branch `feature/hardening`. Hardening
workstream, item 1 of 2 (the other is [observability](observability.md)).

> Implementation notes vs. this proposal: shipped as designed. The harness
> (`e2e/conftest.py`) boots an ephemeral backend + `next build`/`next start`
> frontend on random ports; the spec (`e2e/test_core_loop.py`) drives auth + the
> public render through the browser and the data steps through Playwright's request
> context. Test-only deps live in `backend/requirements-dev.txt` (pytest pinned to
> 8.x — `pytest-playwright` caps pytest <9). CI is `.github/workflows/tests.yml`
> (backend-unit / frontend-unit / e2e). See `e2e/README.md`.

## Goal

Prove the **critical photographer→client journey works through a real browser
against a real stack** — not just unit-level pieces. Today the backend has a solid
pytest suite (220 tests) but it runs against a `TestClient` (no browser, no
frontend), and the frontend has only Vitest unit tests for sort logic. Nothing
exercises Next + FastAPI + SQLite together, and **nothing runs any of it in CI** —
the only workflows are `release.yml` and `security-audit.yml`. A broken login,
upload, share-link, or ZIP path could ship unnoticed.

This adds one **happy-path Playwright smoke test** over the core loop, plus a CI
workflow that runs the existing unit suites *and* the new E2E on every push/PR —
closing the "tests never run automatically" gap.

## Scope (first pass — the core loop)

One spec, the journey that matters most:

1. **Setup wizard** — fresh instance → create admin (username + password).
2. **Login** — log in as that admin; land on `/admin`.
3. **Create a gallery** — name it; it appears in the admin list.
4. **Upload an image** — upload a small generated PNG; wait for processing to
   finish (thumb renders).
5. **Open the share link as a client** — grab the gallery's public `/g/<token>`
   URL, open it in a fresh browser context (no admin cookie), see the photo.
6. **Rate + comment** — set a rating/flag and post a comment as the client.
7. **Download** — trigger the public ZIP download and assert the bytes arrive
   (sized stream → `Content-Length`).

Explicitly **out of scope for pass 1** (revisit later): password-protected
galleries, client-upload moderation, factory-reset/restore, real-time WebSocket
assertions (the WS dev-proxy gotcha in [[local-dev-environment]] makes it
environment-fragile), i18n locale switching, mobile viewports.

## Tooling decision: Python Playwright + pytest

Playwright **Python** 1.60 + Chromium is already installed in `backend/.venv`
(used for screenshot verification today) and the team's whole test idiom is
pytest. So E2E rides the same toolchain rather than introducing a parallel
Node/`@playwright/test` runner:

- Add `pytest-playwright` (brings the sync `page`/`context`/`browser` fixtures) to
  a new **`backend/requirements-dev.txt`** (which also pins `pytest` + the E2E
  deps — today pytest is installed but unpinned).
- Specs live in a top-level **`e2e/`** dir (not `backend/tests/`, which is
  `TestClient`-only) with their own `conftest.py` that boots the live stack.

## Harness: ephemeral, isolated, two-server

The hard part is running a real frontend against a real backend **without touching
Niels' running `:3000`/`:8000` dev stack** (see [[local-dev-environment]]). The
`conftest.py` session fixture:

1. **Temp data dir** — `tempfile.mkdtemp()`; set `DB_URL`/`UPLOAD_DIR`/`EXPORTS_DIR`
   /`BRANDING_DIR`/`WATERMARKS_DIR` + a deterministic `SECRET_KEY` into a child env.
2. **Backend** — `alembic upgrade head` against the temp DB, then launch
   `uvicorn app.main:app` on an **ephemeral free port** (bind `:0`, read it back)
   as a subprocess; poll `/api/health` until green.
3. **Frontend** — `next build` once, then `next start` on another ephemeral port
   with **`NEXT_PUBLIC_API_BASE=http://127.0.0.1:<backend-port>`**. The
   `next.config.ts` rewrites (`/api`, `/uploads`, `/branding`) read that env at
   server boot, so the standalone server proxies to *our* backend — exactly how
   nginx routes in prod, minus nginx. (`next start` avoids the dev-daemon reuse
   trap that would otherwise ignore the port/env locally.)
4. **Teardown** — terminate both subprocesses, remove the temp dir.

Playwright drives `http://127.0.0.1:<frontend-port>`. Ephemeral ports + a private
data dir mean it's safe to run while the dev stack is up, and parallel-safe in CI.

> A faster local-only variant (`next dev` + the dev daemon) is possible but
> fragile per the daemon-reuse note; `build`+`start` is the portable default. A
> `--reuse-dev` opt-in flag can be a follow-up if the build step proves slow in
> the local loop.

## CI workflow (new `.github/workflows/tests.yml`)

Runs on push to `main` and on PRs. Three jobs (mirrors the
`if: server_url == github.com` guard from `security-audit.yml`, since the Forgejo
mirror has no runner):

| Job | Steps |
|---|---|
| `backend-unit` | setup-python 3.12 → `pip install -r requirements.txt -r requirements-dev.txt` → `pytest` |
| `frontend-unit` | setup-node → `npm ci` → `npm run lint` → `npm test` (Vitest) → `npm run build` |
| `e2e` | both of the above toolchains → `playwright install --with-deps chromium` → `pytest e2e/` |

E2E is the flaky/slow one, so: pin to Chromium only, generous per-action timeouts,
upload Playwright **trace + screenshot on failure** as a CI artifact for triage,
and one retry on the E2E job. If E2E proves noisy we can gate it to a label rather
than every PR — but it starts on, per the approved decision.

## Files (estimate)

| File | Change |
|---|---|
| `backend/requirements-dev.txt` | **new** — pin `pytest`, `pytest-playwright`, `httpx` (test deps) |
| `e2e/conftest.py` | **new** — session fixtures: temp data dir, backend + frontend subprocesses |
| `e2e/test_core_loop.py` | **new** — the 7-step smoke spec |
| `e2e/README.md` | **new** — how to run locally (`pytest e2e/`) + the port/daemon caveats |
| `.github/workflows/tests.yml` | **new** — backend-unit + frontend-unit + e2e jobs |
| `CLAUDE.md` | note the E2E command + new dev-requirements file |
| `docs/architecture/e2e-smoke-tests.md` | promote this proposal once approved |

## Non-goals / follow-ups

- **Full matrix** (Firefox/WebKit, mobile viewports) — Chromium-only first.
- **Visual regression / snapshot diffing** — separate concern.
- **Docker-compose-based E2E** (drive the real nginx too) — heavier; the rewrite
  harness covers the app logic without the proxy layer.
- **Broader flows** (password galleries, moderation, restore) — pass 2.

## Open question for approval

- OK to add **`backend/requirements-dev.txt`** as the home for test-only deps
  (pytest etc. are currently unpinned)? Alternative is a `[project.optional-
  dependencies]` group, but there's no `pyproject.toml` for the backend today, so
  a requirements file is the lighter fit.
