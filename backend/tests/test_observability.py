# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Observability: health/readiness, request-id correlation, JSON logging, Sentry no-op.

See docs/architecture/observability.md."""

import json
import logging

from fastapi.testclient import TestClient

from app import observability
from app.main import app
from app.version import __version__


# --- health / readiness --------------------------------------------------------------------

def test_health_liveness_reports_version():
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__


def test_health_ready_reports_components():
    """DB is reachable and storage is writable in the test env, so readiness is never an error.
    (Migrations read as "behind" here — the suite uses create_all, not an alembic stamp.)"""
    client = TestClient(app)
    r = client.get("/api/health/ready")
    assert r.status_code == 200  # DB up → never 503
    checks = r.json()["checks"]
    assert checks["database"] == "ok"
    assert checks["storage"] == "ok"
    # ml_sidecar depends on whether ML_SERVICE_URL is set in the env — just assert a valid state.
    assert checks["ml_sidecar"] in ("unconfigured", "ok", "unreachable")
    assert "migrations" in checks


# --- request correlation -------------------------------------------------------------------

def test_request_id_is_generated_and_echoed():
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.headers.get("x-request-id")


def test_inbound_request_id_is_preserved():
    client = TestClient(app)
    r = client.get("/api/health", headers={"X-Request-ID": "trace-abc-123"})
    assert r.headers.get("x-request-id") == "trace-abc-123"


# --- structured logging --------------------------------------------------------------------

def test_json_formatter_emits_request_id_and_access_fields():
    observability.request_id_ctx.set("rid-xyz")
    rec = logging.LogRecord("app.access", logging.INFO, __file__, 1, "GET / -> 200", (), None)
    observability.RequestIdFilter().filter(rec)
    rec.method, rec.path, rec.status, rec.duration_ms = "GET", "/x", 200, 4.2

    payload = json.loads(observability.JsonFormatter().format(rec))
    assert payload["level"] == "INFO"
    assert payload["request_id"] == "rid-xyz"
    assert payload["method"] == "GET" and payload["status"] == 200
    assert payload["msg"] == "GET / -> 200"


def test_configure_logging_is_idempotent():
    observability.configure_logging()
    observability.configure_logging()  # must not raise on re-apply


# --- error tracking ------------------------------------------------------------------------

def test_init_sentry_is_noop_without_dsn():
    # No SENTRY_DSN in the test env → init must be a complete no-op (and import nothing).
    assert observability.init_sentry() is None


def test_scrub_event_redacts_bodies_and_auth():
    event = {
        "request": {
            "data": {"password": "supersecret"},
            "cookies": {"access_token": "jwt"},
            "headers": {"Authorization": "Bearer x", "Cookie": "access_token=jwt", "Accept": "*/*"},
        }
    }
    scrubbed = observability._scrub_event(event, {})
    req = scrubbed["request"]
    assert "data" not in req
    assert "cookies" not in req
    assert req["headers"]["Authorization"] == "[redacted]"
    assert req["headers"]["Cookie"] == "[redacted]"
    assert req["headers"]["Accept"] == "*/*"  # non-sensitive header preserved
