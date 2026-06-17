# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Shared pytest fixtures.

The whole suite runs against an isolated, throw-away SQLite database and temp media dirs so it
never touches the developer's working `data/` directory. Environment is configured *before* any
`app.*` import (pydantic-settings reads env at import time), so this module must set os.environ at
the very top, before importing the application.
"""

import os
import tempfile

# --- Isolate config BEFORE importing the app -------------------------------------------------
_TMP = tempfile.mkdtemp(prefix="contactsheet-tests-")
os.environ["DB_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db')}"
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["EXPORTS_DIR"] = os.path.join(_TMP, "exports")
os.environ["BRANDING_DIR"] = os.path.join(_TMP, "branding")
os.environ["WATERMARKS_DIR"] = os.path.join(_TMP, "watermarks")
os.environ["SECRET_KEY"] = "test-secret-key-deterministic"
os.environ["COOKIE_SECURE"] = "false"
# Clear any env that would auto-complete setup so tests drive the wizard explicitly.
os.environ.pop("ADMIN_PASSWORD", None)
for _d in ("UPLOAD_DIR", "EXPORTS_DIR", "BRANDING_DIR", "WATERMARKS_DIR"):
    os.makedirs(os.environ[_d], exist_ok=True)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Import models so they register on Base.metadata before create_all.
from app import models  # noqa: F401,E402
from app.database import Base, engine, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.runtime_config import set_secret_key, set_token_version  # noqa: E402
from app.auth.password import hash_password  # noqa: E402
from app.repositories import settings_repo  # noqa: E402
from app.rate_limit import limiter  # noqa: E402

# The lifespan (which normally sets these) does not run for a bare TestClient, so wire the
# runtime secret + token generation by hand.
set_secret_key(os.environ["SECRET_KEY"])
set_token_version(1)

# The per-IP brute-force limiter is in-memory and shared across the whole TestClient session,
# so leave it off by default; tests that assert rate-limiting re-enable it explicitly.
limiter.enabled = False

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "supersecret123"


@pytest.fixture(autouse=True)
def _fresh_db():
    """Drop + recreate every table around each test for full isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    # Factory-reset tests rotate the runtime secret/token-version; restore deterministic values.
    set_secret_key(os.environ["SECRET_KEY"])
    set_token_version(1)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


def _complete_setup(client: TestClient) -> None:
    client.post("/api/setup", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})


@pytest.fixture
def setup_done(client):
    """A fresh instance with the setup wizard completed (admin account created)."""
    _complete_setup(client)
    return client


@pytest.fixture
def admin_client(client):
    """A TestClient already authenticated as admin (login cookie set on the client jar)."""
    _complete_setup(client)
    resp = client.post(
        "/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": False},
    )
    assert resp.status_code == 200, resp.text
    return client
