# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Shared slowapi limiter for brute-force-sensitive endpoints.

Keyed on the real client IP. The app is typically deployed behind a reverse
proxy (nginx / Nginx Proxy Manager), which sets ``X-Real-IP`` and appends to
``X-Forwarded-For``; without honouring those, every request would share the
proxy's IP and a single client could lock everyone out (or evade the limit).
Storage is in-memory, which is correct for the single-process self-hosted
deployment model (one uvicorn worker, SQLite, local filesystem).

``X-Forwarded-For`` is **attacker-controlled** on its left: a client can send any
value and the proxy only *appends* to it. So we must NOT trust the leftmost entry
(the historical bug — it let an attacker spoof a fresh IP per request and fully
bypass every per-IP rate limit, e.g. admin-login and gallery-password brute force,
and poison the IP audit log). The only trustworthy entries are the rightmost
``trusted_proxy_hops`` ones, appended by our own proxies; the real client is the
entry that many positions from the right.
"""

from slowapi import Limiter
from starlette.requests import Request

from app.config import settings


def client_ip(request: Request) -> str:
    """Real client IP, trusting only the proxy-appended tail of ``X-Forwarded-For``.

    With ``trusted_proxy_hops`` (default 1) reverse proxies in front of the app, the client
    address is the XFF entry ``trusted_proxy_hops`` positions from the right — every entry to the
    left of it is client-supplied and never trusted. Falls back to ``X-Real-IP`` then the socket
    peer. Set ``trusted_proxy_hops=0`` to ignore forwarded headers entirely (app directly exposed).
    """
    hops = settings.trusted_proxy_hops
    if hops > 0:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            # Only the rightmost `hops` entries were added by our proxies; take the one the
            # outermost trusted proxy saw as its peer. If the chain is shorter than expected
            # (misconfig / fewer proxies than declared), fall back rather than trust a spoofable
            # leftmost value.
            if len(parts) >= hops:
                return parts[-hops]
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_ip)
