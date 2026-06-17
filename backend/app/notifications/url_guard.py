# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Opt-in SSRF guard for notification targets.

OFF by default (``settings.block_internal_notification_targets``): ContactSheet is self-hosted and
pointing ntfy/SMTP at a LAN host is a normal, supported setup, so we never block internal targets
unless the operator explicitly turns this on.

When on, it refuses Apprise URLs whose *host* resolves to a non-public address. The check applies
only to schemes where the netloc is an operator-supplied host (custom webhooks, SMTP, ntfy); SaaS
preset schemes (pushover/telegram/slack/discord) always hit fixed public endpoints and their netloc
holds credentials, not a host, so they're left alone. Best-effort and fail-open: an unparseable URL
is allowed rather than risking a false-positive that breaks a valid channel.

Scope: this only blocks *internal* targets. It deliberately does NOT stop an admin routing
notification payloads to a *public* attacker host (json://attacker.example) — that data-exfil
vector is an accepted, documented risk (the configuring actor is already a full-access admin). See
docs/architecture/notifications.md → "Security & trade-offs".
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlsplit

from app.config import settings

_log = logging.getLogger(__name__)

# Schemes whose netloc is an operator-controlled host we should vet. Apprise generic webhooks
# (json/xml/form, + their TLS variants), SMTP (mailto), and ntfy all connect to that host.
_HOST_SCHEMES = {
    "json", "jsons", "xml", "xmls", "form", "forms",
    "mailto", "mailtos", "ntfy", "ntfys", "http", "https",
}


def _host_of(url: str) -> str | None:
    """The connect host for a host-controlled scheme, or None when the scheme isn't one we vet
    (SaaS preset) or the URL can't be parsed."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    scheme = (parts.scheme or "").lower()
    if scheme not in _HOST_SCHEMES:
        return None  # SaaS preset or unknown — host isn't operator-controlled, leave it alone
    host = parts.hostname  # already strips userinfo + port, unbrackets IPv6
    return host or None


def _is_internal_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def block_reason(url: str) -> str | None:
    """Return a human-readable reason if ``url`` must be refused, else None.

    Always None when the guard is disabled, when the scheme isn't host-controlled, or when the
    host can't be resolved (fail-open). When enabled, *any* resolved address being internal blocks
    the URL (so a hostname that resolves to a mix can't smuggle a request to a private IP)."""
    if not settings.block_internal_notification_targets:
        return None
    host = _host_of(url)
    if not host:
        return None

    # Resolve to every candidate address (literal IPs short-circuit DNS). DNS failure → fail-open.
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return None
    addresses = {info[4][0] for info in infos}
    if any(_is_internal_ip(addr) for addr in addresses):
        _log.warning("Blocked internal notification target host %r (%s)", host, sorted(addresses))
        return f"Refusing notification target '{host}': resolves to an internal/private address"
    return None


def is_allowed(url: str) -> bool:
    """Backstop convenience wrapper used in the send path."""
    return block_reason(url) is None
