# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Notification SSRF-surface hardening: rate limit, send timeout, opt-in internal-target guard.

Threat model: an untrusted/limited admin abusing custom Apprise URLs. The default posture stays
self-hoster-friendly (LAN/internal targets allowed) — only the opt-in flag changes that.
"""

import sys
import time
import types

import pytest

from app.config import settings
from app.notifications import apprise_client, url_guard
from app.rate_limit import limiter


# --- URL guard (unit) ------------------------------------------------------------------------

@pytest.fixture
def guard_on(monkeypatch):
    monkeypatch.setattr(settings, "block_internal_notification_targets", True)


def test_guard_off_by_default_allows_internal():
    # Default config: nothing is blocked, so LAN targets keep working out of the box.
    assert settings.block_internal_notification_targets is False
    assert url_guard.block_reason("json://127.0.0.1/x") is None
    assert url_guard.block_reason("jsons://169.254.169.254/latest/meta-data/") is None


@pytest.mark.parametrize(
    "url",
    [
        "json://127.0.0.1/hook",            # loopback
        "jsons://169.254.169.254/latest/",  # link-local (cloud metadata)
        "json://10.0.0.5:6379",             # RFC1918
        "json://192.168.1.10/x",            # RFC1918
        "mailtos://user:pw@localhost/?to=a@b.com",  # loopback via hostname + userinfo
        "ntfys://0.0.0.0/topic",            # unspecified
    ],
)
def test_guard_blocks_internal_when_enabled(guard_on, url):
    assert url_guard.block_reason(url) is not None


@pytest.mark.parametrize(
    "url",
    [
        "jsons://1.1.1.1/hook",             # public IP
        "pover://userkey@apptoken",         # SaaS preset — host isn't operator-controlled
        "tgram://bottoken/123456",          # SaaS preset
        "discord://id/token",               # SaaS preset
        "slack://a/b/c",                    # SaaS preset
    ],
)
def test_guard_allows_public_and_saas_when_enabled(guard_on, url):
    assert url_guard.block_reason(url) is None


# --- Send timeout (unit) ---------------------------------------------------------------------

def test_send_enforces_wall_clock_timeout(monkeypatch):
    """A hung target must not pin the caller: send() returns False within ~timeout."""

    class _SlowAp:
        def add(self, url):
            return True

        def notify(self, title, body):
            time.sleep(5)  # simulate a target that accepts but never responds
            return True

    fake = types.ModuleType("apprise")
    fake.Apprise = lambda: _SlowAp()
    monkeypatch.setitem(sys.modules, "apprise", fake)

    start = time.monotonic()
    result = apprise_client.send("json://1.1.1.1/hook", "t", "b", timeout=0.3)
    elapsed = time.monotonic() - start

    assert result is False
    assert elapsed < 2.0  # returned promptly, well before the 5s fake send


def test_send_refuses_internal_target_when_guard_on(monkeypatch):
    monkeypatch.setattr(settings, "block_internal_notification_targets", True)
    # apprise must never be reached for a blocked target.
    fake = types.ModuleType("apprise")

    def _boom():
        raise AssertionError("apprise should not be invoked for a blocked target")

    fake.Apprise = _boom
    monkeypatch.setitem(sys.modules, "apprise", fake)
    assert apprise_client.send("json://127.0.0.1/x", "t", "b") is False


# --- Test endpoint (integration) -------------------------------------------------------------

def _stub_send(monkeypatch, recorder=None):
    def _fake(url, title, body, timeout=None):
        if recorder is not None:
            recorder.append(url)
        return True
    monkeypatch.setattr(apprise_client, "send", _fake)


def test_test_endpoint_allows_internal_by_default(admin_client, monkeypatch):
    sent = []
    _stub_send(monkeypatch, sent)
    r = admin_client.post(
        "/api/admin/settings/notifications/test",
        json={"type": "custom", "url": "json://127.0.0.1/hook"},
    )
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert sent == ["json://127.0.0.1/hook"]  # LAN target delivered, as a self-hoster expects


def test_test_endpoint_blocks_internal_when_flag_on(admin_client, monkeypatch):
    monkeypatch.setattr(settings, "block_internal_notification_targets", True)
    sent = []
    _stub_send(monkeypatch, sent)
    r = admin_client.post(
        "/api/admin/settings/notifications/test",
        json={"type": "custom", "url": "json://127.0.0.1/hook"},
    )
    assert r.status_code == 400
    assert "internal/private" in r.json()["detail"]
    assert sent == []  # never reached the sender


def test_test_endpoint_rate_limited(admin_client, monkeypatch):
    _stub_send(monkeypatch)
    # Re-enable the limiter (disabled globally for the suite) just for this test.
    try:
        limiter._storage.reset()
    except Exception:
        pass
    limiter.enabled = True
    try:
        payload = {"type": "custom", "url": "json://1.1.1.1/hook"}
        codes = [
            admin_client.post("/api/admin/settings/notifications/test", json=payload).status_code
            for _ in range(6)
        ]
    finally:
        limiter.enabled = False
    assert codes[:5] == [200, 200, 200, 200, 200]  # 5/minute allowed
    assert codes[5] == 429  # 6th is throttled
