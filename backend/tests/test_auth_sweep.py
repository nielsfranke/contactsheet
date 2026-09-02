# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Every non-public API route must refuse an anonymous caller. Walks the OpenAPI schema (so a
route added tomorrow is covered automatically) and hits each admin/PAT endpoint without any
credentials, expecting 401 — a regression that drops `get_current_admin` / `require_scope` from a
handler ships red instead of green."""

import re

import pytest
from fastapi.testclient import TestClient

from app.main import app

# Routes that are open by design: the public gallery surface, the setup wizard, login, health,
# legal pages and the PWA icons. Everything else under /api needs the admin cookie or a PAT.
_PUBLIC = (
    re.compile(r"^/api/public/"),
    re.compile(r"^/api/setup(/|$)"),
    re.compile(r"^/api/auth/login$"),
    re.compile(r"^/api/health(/|$)"),
    re.compile(r"^/api/branding/"),
)


def _is_public(path: str) -> bool:
    return any(p.match(path) for p in _PUBLIC)


def _protected_routes() -> list[tuple[str, str]]:
    routes = []
    for path, ops in app.openapi()["paths"].items():
        if not path.startswith("/api") or _is_public(path):
            continue
        for method in ops:
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                routes.append((method.upper(), path))
    return sorted(routes)


_ROUTES = _protected_routes()


def test_sweep_covers_the_api():
    assert len(_ROUTES) > 40, _ROUTES  # sanity: the walk actually found the API


@pytest.mark.parametrize("method,path", _ROUTES, ids=[f"{m} {p}" for m, p in _ROUTES])
def test_anonymous_is_refused(method, path):
    url = re.sub(r"\{[^}]+\}", "00000000-0000-4000-8000-000000000000", path)
    r = TestClient(app).request(method, url)
    assert r.status_code == 401, f"{method} {path} → {r.status_code}: {r.text[:120]}"
