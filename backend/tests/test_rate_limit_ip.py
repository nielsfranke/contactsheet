# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Regression tests for client-IP resolution behind a reverse proxy.

`X-Forwarded-For` is attacker-controlled on its left (the proxy only appends), so trusting the
leftmost entry let an attacker spoof a fresh IP per request and bypass every per-IP rate limit
(admin-login / gallery-password brute force) and poison the IP audit log. We must trust only the
proxy-appended tail. See app/rate_limit.py.
"""

import pytest
from starlette.datastructures import Headers

from app.config import settings
from app.rate_limit import client_ip, limiter


class _Req:
    """Minimal stand-in carrying just what client_ip reads."""

    def __init__(self, headers=None, peer="10.0.0.1"):
        self.headers = Headers(headers or {})
        self.client = type("C", (), {"host": peer})() if peer else None


def test_ignores_spoofed_leftmost_xff_default_one_hop():
    # Proxy appended the real client (1.2.3.4) after the client-supplied spoof.
    assert client_ip(_Req({"X-Forwarded-For": "9.9.9.9, 1.2.3.4"})) == "1.2.3.4"


def test_spoof_rotation_resolves_to_same_client():
    # An attacker rotating the leftmost value must still map to one stable bucket.
    a = client_ip(_Req({"X-Forwarded-For": "5.5.5.5, 1.2.3.4"}))
    b = client_ip(_Req({"X-Forwarded-For": "6.6.6.6, 1.2.3.4"}))
    assert a == b == "1.2.3.4"


def test_single_entry_xff_is_the_client():
    assert client_ip(_Req({"X-Forwarded-For": "1.2.3.4"})) == "1.2.3.4"


def test_two_trusted_hops(monkeypatch):
    # client → NPM → bundled nginx → app: real client is two from the right.
    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)
    hdr = {"X-Forwarded-For": "9.9.9.9, 1.2.3.4, 172.16.0.5"}
    assert client_ip(_Req(hdr)) == "1.2.3.4"


def test_zero_hops_ignores_forwarded_headers(monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    hdr = {"X-Forwarded-For": "9.9.9.9, 1.2.3.4", "X-Real-IP": "8.8.8.8"}
    assert client_ip(_Req(hdr, peer="203.0.113.7")) == "203.0.113.7"


def test_falls_back_to_real_ip_then_peer():
    assert client_ip(_Req({"X-Real-IP": "8.8.8.8"})) == "8.8.8.8"
    assert client_ip(_Req({}, peer="203.0.113.7")) == "203.0.113.7"


def test_short_chain_does_not_trust_spoofable_leftmost(monkeypatch):
    # Declared 2 hops but only one XFF entry arrived (misconfig): don't trust it; use the peer.
    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)
    assert client_ip(_Req({"X-Forwarded-For": "9.9.9.9"}, peer="203.0.113.7")) == "203.0.113.7"


def test_login_brute_force_not_bypassable_via_xff_rotation(setup_done):
    """End-to-end: rotating the spoofed leftmost XFF can't reset the login limiter bucket."""
    try:
        limiter._storage.reset()
    except Exception:
        pass
    limiter.enabled = True
    try:
        codes = []
        for i in range(12):
            # Simulate one reverse proxy appending the *same* real client after the spoof.
            r = setup_done.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrong", "remember": False},
                headers={"X-Forwarded-For": f"{i}.{i}.{i}.{i}, 203.0.113.9"},
            )
            codes.append(r.status_code)
    finally:
        limiter.enabled = False
    # 10/minute → the 11th+ attempt from the (stable) real client is throttled despite the
    # ever-changing spoofed leftmost entry.
    assert 429 in codes, codes
