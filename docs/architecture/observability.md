<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Observability — structured logging, error tracking, deep health

**Status:** implemented (2026-06-25) on branch `feature/hardening`. Hardening
workstream, item 2 of 2 (the other is [e2e smoke tests](e2e-smoke-tests.md)).

> Implementation notes vs. this proposal: all three pieces shipped as designed.
> Logging/Sentry init live in `app/observability.py`, wired at the top of
> `app/main.py` (before the app is built). Health is split into `/api/health`
> (liveness + version) and `/api/health/ready` (component checks). No migration.
> Covered by `backend/tests/test_observability.py`.

## Goal

Give a self-hosted operator (and Niels, debugging a remote report) **a way to see
what the instance is doing and when it breaks** — without standing up a heavy
stack. Today: logging is whatever uvicorn prints by default (`logging.getLogger`
with no central config, no request correlation), there's no error aggregation, and
`/api/health` returns a bare `{"status": "ok"}` that can't tell a load balancer
whether the **DB** or **migrations** are actually fine.

Three additions, each independently useful and **off/cheap by default** (this is
self-hosted, AGPL software — no phone-home, no required external service):

1. **Structured logging + request correlation.**
2. **Opt-in error tracking (Sentry SDK), initialized only when a DSN is set.**
3. **A deep health/readiness check.**

## 1. Structured logging + request IDs

A central `app/observability.py` (`configure_logging()`), called at the top of the
lifespan / app construction, applies a `logging.config.dictConfig`:

- **Format switch** via `LOG_FORMAT` (`text` default | `json`). `json` emits one
  JSON object per line (`ts`, `level`, `logger`, `msg`, `request_id`, plus
  `method`/`path`/`status`/`duration_ms` on access lines) — friendly to `jq`, Loki,
  or any log shipper. `text` keeps today's human-readable console output.
- **`LOG_LEVEL`** (`INFO` default) configurable via env.
- **Uvicorn loggers** (`uvicorn`, `uvicorn.error`, `uvicorn.access`) are folded
  into the same handler/format so output is consistent (no double-logging).

A lightweight **request-ID middleware**: read an inbound `X-Request-ID` or mint a
UUID, stash it in a `contextvar`, attach it to every log record via a filter, and
echo it back as a response header. This is what lets you grep one client's whole
request across log lines. It also logs one access line per request
(method, path, status, duration) — **skipping `/api/health*`** to avoid
load-balancer poll noise.

No new dependency for this part (stdlib `logging` + `contextvars`).

## 2. Opt-in error tracking (Sentry SDK)

Per the approved decision: add `sentry-sdk` to `requirements.txt`, but
**initialize only when `SENTRY_DSN` is set** — default deploys import nothing
active and phone home to nobody. Works against **self-hosted Sentry / GlitchTip**,
so it stays self-host-friendly.

`init_sentry()` (in `observability.py`, called once at startup):

```python
sentry_sdk.init(
    dsn=settings.sentry_dsn,                 # None → no-op, never initialized
    environment=settings.sentry_environment, # e.g. "prod" / hostname
    release=__version__,                     # ties events to the build
    traces_sample_rate=settings.sentry_traces_sample_rate,  # default 0.0 (errors only)
    send_default_pii=False,                  # privacy: no cookies/headers/IPs by default
)
```

Privacy guardrails (important for this app's data):

- **`send_default_pii=False`** — no client IPs, cookies, or auth headers attached.
- A **`before_send` scrubber** drops request bodies (they carry photos + the admin
  password on login/restore) and redacts the `Authorization`/`Cookie` headers and
  the `access_token` cookie, belt-and-suspenders over the SDK defaults.
- FastAPI/Starlette/SQLAlchemy integrations on; **logging integration** wired so
  `logger.error(...)` / unhandled 500s become Sentry events automatically.

The existing `CodedHTTPException` handler and 4xx client errors are **not** sent as
errors (they're expected); only unhandled exceptions / 5xx escalate.

## 3. Deep health / readiness

Keep the contract clean for orchestrators:

- **`GET /api/health`** — *liveness*, unchanged shape but adds `version`. Always
  cheap, always 200 if the process is up: `{"status": "ok", "version": "1.2.3"}`.
- **`GET /api/health/ready`** — *readiness*. Checks the things a deploy actually
  depends on and returns per-component status; **503** if a hard dependency
  (the DB) is down, **200** otherwise:

  ```jsonc
  {
    "status": "ok" | "degraded" | "error",
    "version": "1.2.3",
    "checks": {
      "database": "ok",                 // SELECT 1
      "migrations": "ok" | "behind",    // DB revision == migrations.current_head()
      "ml_sidecar": "ok" | "unconfigured" | "unreachable",  // only if ML_SERVICE_URL set
      "storage": "ok"                   // upload/exports dirs writable
    }
  }
  ```

  Reuses `app/migrations.py` (`current_head` / `revision_of_db`) and
  `app/ml/embedder.health()` — both already exist. **No sensitive values** in the
  payload (no paths, no secrets), so it can stay unauthenticated for probes;
  `migrations: behind` is the actionable signal that an operator pulled an image
  but didn't run `alembic upgrade head`.

## Config additions (`app/config.py`)

```python
log_level: str = "INFO"
log_format: Literal["text", "json"] = "text"
sentry_dsn: str | None = None
sentry_environment: str | None = None
sentry_traces_sample_rate: float = 0.0
```

All env-overridable (pydantic-settings), all with safe defaults → a default
`docker compose up` behaves exactly as today plus a richer health endpoint.

## Deploy / upgrade impact

- **New dependency** `sentry-sdk` in `requirements.txt` (small, pure-Python) — but
  dormant unless `SENTRY_DSN` is set. Picked up by the normal image rebuild; the
  weekly `security-audit.yml` pip-audit covers it automatically.
- **No migration**, no schema change, no nginx change.
- Document the new env vars in `CLAUDE.md` + `docker-compose.yml` comments and a
  short "Observability" section in the ops docs (how to turn on JSON logs / point
  at a Sentry DSN / what `/api/health/ready` reports).

## Non-goals / follow-ups

- **Prometheus `/metrics` endpoint** — a natural next step (request counts,
  latencies, queue depth for the image/embeed pools), but heavier and arguably
  redundant with structured access logs at self-hosted scale. Deferred; note the
  hook so it can ride the same `observability.py`.
- **Distributed tracing / OpenTelemetry** — overkill for a single-container app.
- **Frontend error tracking** (Sentry browser SDK) — possible later; this proposal
  is backend-only.
- **Log retention / rotation** — the operator's stack (Docker log driver, etc.)
  owns that; we only choose the *format*.

## Files (estimate)

| File | Change |
|---|---|
| `backend/app/observability.py` | **new** — `configure_logging`, request-ID middleware/filter, `init_sentry`, `before_send` scrubber |
| `backend/app/config.py` | add `log_level`/`log_format`/`sentry_*` settings |
| `backend/app/main.py` | call `configure_logging()` + `init_sentry()` at startup; add middleware; expand health routes |
| `backend/requirements.txt` | add `sentry-sdk` |
| `backend/tests/test_observability.py` | **new** — health/ready component states, request-ID echo, JSON log shape, Sentry no-op without DSN |
| `CLAUDE.md` / `docker-compose.yml` | document the new env vars |
| `docs/architecture/observability.md` | promote this proposal once approved |
