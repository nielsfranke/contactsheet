# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""End-to-end harness: boot a real backend + frontend on ephemeral ports, fully isolated.

Unlike backend/tests/ (which runs under FastAPI's TestClient — no browser, no Next), this suite
drives a real browser via Playwright against live servers, so it exercises Next SSR, the CSP, the
auth cookie, the `/api`+`/uploads` rewrites, the FastAPI backend, image processing and static
serving together. Everything runs against a throwaway temp data dir on random ports, so it's safe
to run while the dev stack (:3000/:8000) is up. See docs/architecture/e2e-smoke-tests.md."""

import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
# Console scripts (alembic/uvicorn) live next to the interpreter running pytest — the local venv's
# bin/ or, in CI, the runner's Python bin/ where pip installed them. Mirrors app/migrations.py.
BIN = Path(sys.executable).parent


def _free_port() -> int:
    """Grab a free TCP port (race-y but fine — the server binds it moments later)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_ready(url: str, timeout: float = 180.0) -> None:
    deadline = time.time() + timeout
    last: object = None
    while time.time() < deadline:
        try:
            r = httpx.get(url, timeout=3)
            if r.status_code < 500:
                return
            last = r.status_code
        except Exception as exc:  # connection refused while the server boots
            last = exc
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url} (last={last!r})")


def _terminate(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="session")
def backend_url():
    """A uvicorn backend on a free port, against a fresh migrated SQLite DB in a temp dir."""
    data = Path(tempfile.mkdtemp(prefix="cs-e2e-data-"))
    for sub in ("uploads", "exports", "branding", "watermarks"):
        (data / sub).mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "DB_URL": f"sqlite:///{data / 'e2e.db'}",
        "UPLOAD_DIR": str(data / "uploads"),
        "EXPORTS_DIR": str(data / "exports"),
        "BRANDING_DIR": str(data / "branding"),
        "WATERMARKS_DIR": str(data / "watermarks"),
        "SECRET_KEY": secrets.token_hex(32),
        "COOKIE_SECURE": "false",
        "ML_SERVICE_URL": "",  # never touch a real sidecar from E2E
        "LOG_LEVEL": "WARNING",
    }
    subprocess.run([str(BIN / "alembic"), "upgrade", "head"], cwd=BACKEND, env=env, check=True)

    port = _free_port()
    proc = subprocess.Popen(
        [str(BIN / "uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=BACKEND,
        env=env,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_ready(f"{url}/api/health")
        yield url
    finally:
        _terminate(proc)
        shutil.rmtree(data, ignore_errors=True)


@pytest.fixture(scope="session")
def frontend_url(backend_url):
    """A production Next server (`build` + `start`) on a free port, whose `/api`+`/uploads` rewrites
    point at the ephemeral backend via NEXT_PUBLIC_API_BASE. The env must be set on the *build*:
    `next build` evaluates next.config.ts and bakes the rewrite destinations into
    .next/routes-manifest.json — `next start` only serves that manifest and ignores the env, so a
    prebuilt .next cannot be repointed. `next start` (not `next dev`) sidesteps the dev-daemon
    reuse trap that ignores the port/env."""
    port = _free_port()
    env = {**os.environ, "NEXT_PUBLIC_API_BASE": backend_url, "PORT": str(port)}

    subprocess.run(["npm", "run", "build"], cwd=FRONTEND, env=env, check=True)
    proc = subprocess.Popen(
        ["npm", "run", "start", "--", "--hostname", "127.0.0.1", "--port", str(port)],
        cwd=FRONTEND,
        env=env,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_ready(url)
        yield url
    finally:
        _terminate(proc)
