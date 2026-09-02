# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Quiescence gate for operations that swap the SQLite file underneath a running app (restore).

SQLite's WAL is bound to the database *by file name*: a connection that still holds the old inode
and writes after the swap appends frames for the old page layout into ``<db>-wal`` — which the
new file then replays. ``engine.dispose()`` only closes *idle* pooled connections, so before the
swap every session opened by a request or a background worker must be gone and no new one may
start. This module counts them:

- ``request_session()`` wraps the ``get_db`` dependency (every API request);
- ``background_work()`` / ``submit()`` / ``tracked`` wrap the worker pools, the ZIP/backup
  ``BackgroundTasks`` and the notification flusher tick — counted from *enqueue*, not from start,
  so a queued-but-not-yet-running rendition job is not mistaken for idle;
- ``quiesce()`` raises the "restore in progress" flag (new requests get a 503, the flusher skips
  its tick, the pools are refused new work) and waits for the counters to drain.

The restore refuses (409) rather than proceeds when the instance doesn't go idle in time — a
half-corrupted database is the one outcome worse than a retried restore.
"""

from __future__ import annotations

import contextlib
import functools
import threading
import time
from concurrent.futures import Executor
from typing import Callable, Iterator

_lock = threading.Lock()
_idle = threading.Condition(_lock)
_active_requests = 0
_active_background = 0

# Raised while a restore swaps files. Checked by get_db (503), the flusher (skip) and submit().
restore_in_progress = threading.Event()


def _change(kind: str, delta: int) -> None:
    global _active_requests, _active_background
    with _lock:
        if kind == "request":
            _active_requests += delta
        else:
            _active_background += delta
        if _active_requests == 0 and _active_background == 0:
            _idle.notify_all()


@contextlib.contextmanager
def request_session() -> Iterator[None]:
    """Count one request-scoped DB session (see database.get_db)."""
    _change("request", 1)
    try:
        yield
    finally:
        _change("request", -1)


@contextlib.contextmanager
def background_work() -> Iterator[None]:
    """Count one unit of background work that may touch the DB."""
    _change("background", 1)
    try:
        yield
    finally:
        _change("background", -1)


def tracked(fn: Callable) -> Callable:
    """Decorator: run ``fn`` as counted background work (for FastAPI ``BackgroundTasks``)."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with background_work():
            return fn(*args, **kwargs)

    return wrapper


def submit(executor: Executor, fn: Callable, *args) -> bool:
    """Submit ``fn`` to a worker pool, counted from enqueue until it finishes. Returns False when
    the work was refused (restore in progress, or the pool is shut down) — callers treat that as a
    dropped task, never as an error: restore rebuilds renditions/embeddings from what it restores."""
    if restore_in_progress.is_set():
        return False
    _change("background", 1)

    def run():
        try:
            fn(*args)
        finally:
            _change("background", -1)

    try:
        executor.submit(run)
    except RuntimeError:  # pool shut down (tests / teardown)
        _change("background", -1)
        return False
    return True


def counts() -> tuple[int, int]:
    """(active requests, active/queued background jobs) — for diagnostics and tests."""
    with _lock:
        return _active_requests, _active_background


@contextlib.contextmanager
def quiesce(timeout: float) -> Iterator[bool]:
    """Raise the restore flag and wait up to ``timeout`` seconds for every counted session to
    finish. Yields True once idle, False on timeout (the caller must then abort); the flag is
    lowered on exit either way."""
    restore_in_progress.set()
    try:
        deadline = time.monotonic() + timeout
        with _lock:
            while _active_requests or _active_background:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                _idle.wait(remaining)
            idle = not (_active_requests or _active_background)
        yield idle
    finally:
        restore_in_progress.clear()
