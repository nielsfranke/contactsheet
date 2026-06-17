# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Thin wrapper around Apprise so the rest of the app never imports it directly.

Isolating the dependency keeps the call sites trivial and makes the sender stubbable. ``apprise``
is an optional runtime dependency — if it isn't installed, ``send`` logs and returns False rather
than crashing the request/flusher.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

from app.config import settings
from app.notifications import url_guard

_log = logging.getLogger(__name__)


def _notify(url: str, title: str, body: str) -> bool:
    import apprise

    ap = apprise.Apprise()
    if not ap.add(url):
        _log.warning("apprise rejected notification URL (scheme %s)", url.split("://", 1)[0])
        return False
    return bool(ap.notify(title=title, body=body))


def send(url: str, title: str, body: str, timeout: float | None = None) -> bool:
    """Send ``body`` to a single Apprise URL. Returns True on success. Never raises.

    Enforces a hard wall-clock ``timeout`` (default ``settings.notification_timeout``) so a
    slow/hung target can't pin the caller, and honours the opt-in internal-target guard."""
    if not url:
        return False
    reason = url_guard.block_reason(url)
    if reason:
        _log.warning("notification not sent — %s", reason)
        return False
    try:
        import apprise  # noqa: F401 — fail fast & quietly if the optional dep is missing
    except ImportError:  # pragma: no cover
        _log.warning("apprise is not installed — notification not sent")
        return False

    timeout = settings.notification_timeout if timeout is None else timeout
    # Run the (blocking) send in a worker so we can bound the wait. On timeout we return to the
    # caller immediately and let the worker unwind on its own (Apprise's per-plugin socket timeouts
    # bound the leaked thread); shutdown(wait=False) never blocks here.
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        return bool(executor.submit(_notify, url, title, body).result(timeout=timeout))
    except FutureTimeout:
        _log.warning("notification send timed out after %ss", timeout)
        return False
    except Exception:  # pragma: no cover - defensive
        _log.exception("apprise notify failed")
        return False
    finally:
        executor.shutdown(wait=False)
