# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Shared helpers for the demo seed + capture scripts.

Everything runs against an **isolated** backend on port 8099 with its own data dir
(demo/.data) — it never touches the developer's real instance on :8000/:3000.
"""

from __future__ import annotations

import os
import subprocess
import time
import urllib.request
from pathlib import Path

DEMO_DIR = Path(__file__).resolve().parent
REPO = DEMO_DIR.parent
BACKEND_DIR = REPO / "backend"
FRONTEND_DIR = REPO / "frontend"
VENV = BACKEND_DIR / ".venv" / "bin"
ASSETS = DEMO_DIR / "assets"

DATA = DEMO_DIR / ".data"          # runtime DB + uploads (gitignored)
STATE_FILE = DATA / "state.json"

API_HOST = "127.0.0.1"
API_PORT = 8099
WEB_PORT = 3099
API_BASE = f"http://{API_HOST}:{API_PORT}"
WEB_BASE = f"http://{API_HOST}:{WEB_PORT}"


def demo_env() -> dict[str, str]:
    """Process env for the demo backend — overrides the data dirs so the real .env can't leak in."""
    env = os.environ.copy()
    env.update(
        {
            "DB_URL": f"sqlite:///{DATA / 'demo.db'}",
            "UPLOAD_DIR": str(DATA / "uploads"),
            "EXPORTS_DIR": str(DATA / "exports"),
            "BRANDING_DIR": str(DATA / "branding"),
            "WATERMARKS_DIR": str(DATA / "watermarks"),
            # Keep secret/admin unset so no env auto-setup runs — we drive setup via the API.
            "SECRET_KEY": "",
            "ADMIN_PASSWORD": "",
        }
    )
    return env


def ensure_dirs() -> None:
    for sub in ("uploads", "exports", "branding", "watermarks"):
        (DATA / sub).mkdir(parents=True, exist_ok=True)


def run_migrations() -> None:
    subprocess.run([str(VENV / "alembic"), "upgrade", "head"], cwd=BACKEND_DIR, env=demo_env(), check=True)


def start_backend() -> subprocess.Popen:
    proc = subprocess.Popen(
        [str(VENV / "uvicorn"), "app.main:app", "--host", API_HOST, "--port", str(API_PORT)],
        cwd=BACKEND_DIR,
        env=demo_env(),
    )
    _wait_http(f"{API_BASE}/api/setup/status", "backend")
    return proc


WEBDIR = DEMO_DIR / ".web"  # isolated frontend copy (its own .next) so we never touch frontend/.next


def _prepare_webdir() -> None:
    """Mirror the frontend into demo/.web with its own .next, so running a second dev server
    here can't corrupt the developer's live dev server sharing frontend/.next."""
    WEBDIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["rsync", "-a", "--delete", "--exclude", "node_modules", "--exclude", ".next",
         f"{FRONTEND_DIR}/", f"{WEBDIR}/"],
        check=True,
    )
    link = WEBDIR / "node_modules"
    if link.is_symlink() or link.exists():
        if link.is_symlink():
            link.unlink()
    if not (WEBDIR / "node_modules").exists():
        os.symlink(FRONTEND_DIR / "node_modules", link)

    # Next 16 blocks cross-origin dev resources unless the host is whitelisted; without this the
    # client bundle won't hydrate when Playwright drives the page over 127.0.0.1/localhost.
    cfg = WEBDIR / "next.config.ts"
    text = cfg.read_text()
    if "allowedDevOrigins" not in text:
        text = text.replace(
            'output: "standalone",',
            'output: "standalone",\n  allowedDevOrigins: ["127.0.0.1", "localhost"],',
            1,
        )
        # Drop the Next dev indicator badge so it doesn't appear in the screenshots.
        text = text.replace(
            '  devIndicators: {\n    position: "bottom-right",\n  },',
            "  devIndicators: false,",
            1,
        )
        cfg.write_text(text)


def start_frontend() -> subprocess.Popen:
    _prepare_webdir()
    env = os.environ.copy()
    env["NEXT_PUBLIC_API_BASE"] = API_BASE
    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(WEB_PORT)],
        cwd=WEBDIR,
        env=env,
    )
    _wait_http(f"{WEB_BASE}/login", "frontend", timeout=180)
    return proc


def _wait_http(url: str, name: str, timeout: int = 45) -> None:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status < 500:
                    return
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(1)
    raise RuntimeError(f"{name} did not come up at {url} within {timeout}s (last: {last})")


def stop(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
