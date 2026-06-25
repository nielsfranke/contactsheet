# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Notifications: enqueue notifiable events and drain them via an in-process flusher.

Events are written to ``notification_outbox`` (cheap, in the request path) and a single async
loop (started in the app lifespan) groups unsent rows per gallery and sends one coalesced
message per channel through Apprise. No cron, no external worker.
"""

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.notifications import apprise_client, presets, url_guard
from app.repositories import gallery_repo, notification_repo, settings_repo

_log = logging.getLogger(__name__)

# Event types whose default (when absent from the events map) is OFF. Everything else defaults ON.
_DEFAULT_OFF = {"view"}


# ---- Enqueue (request path) ------------------------------------------------

def enqueue(
    db: Session,
    gallery_id: str,
    event_type: str,
    author: str | None = None,
    meta: dict | None = None,
) -> None:
    """Queue a notifiable event if notifications are globally on, the event type is enabled, and
    the gallery's master switch is on. Never raises into the caller."""
    try:
        cfg = settings_repo.get(db).notifications
        if not cfg or not cfg.get("enabled"):
            return
        events = cfg.get("events") or {}
        default = event_type not in _DEFAULT_OFF
        if not events.get(event_type, default):
            return
        gallery = gallery_repo.get_by_id(db, gallery_id)
        if not gallery or not getattr(gallery, "notifications_enabled", True):
            return
        notification_repo.enqueue(db, gallery_id, event_type, author, meta)
    except Exception:  # pragma: no cover - defensive, must never break the request
        _log.exception("notification enqueue failed")


# ---- Test ------------------------------------------------------------------

def send_test(url: str, instance_name: str) -> bool:
    return apprise_client.send(
        url,
        f"{instance_name} — Test",
        "Test notification from ContactSheet. If you can read this, the channel works.",
    )


# ---- Summary ---------------------------------------------------------------

def _meta(row) -> dict:
    try:
        return json.loads(row.meta) if row.meta else {}
    except Exception:
        return {}


class _Safe(dict):
    """format_map backing dict: an unknown placeholder renders empty, never KeyError."""

    def __missing__(self, key):  # noqa: D401
        return ""


def _render(template: str, ctx: dict) -> str:
    """Substitute a custom template against ``ctx``. Returns "" on any error so the caller can
    fall back to the built-in default — a malformed template must never break delivery."""
    try:
        return template.format_map(_Safe(ctx)).strip()
    except Exception:
        return ""


def _line(templates: dict, key: str, ctx: dict, default: str) -> str:
    """Use the admin's override for ``key`` if set (and it renders non-empty), else the default."""
    override = (templates.get(key) or "").strip()
    if override:
        rendered = _render(override, ctx)
        if rendered:
            return rendered
    return default


def _build_summary(
    instance_name: str, gallery_name: str, rows: list, templates: dict | None = None
) -> tuple[str, str]:
    tmpl = templates or {}
    base = {"instance": instance_name, "gallery": gallery_name}
    by_type: dict[str, list] = defaultdict(list)
    for r in rows:
        by_type[r.event_type].append(r)
    lines: list[str] = []

    for r in by_type.get("comment", []):
        author = r.author or "Someone"
        preview = _meta(r).get("preview", "")
        default = f"💬 New comment from {author}" + (f": “{preview}”" if preview else "")
        lines.append(_line(tmpl, "comment", {**base, "author": author, "preview": preview}, default))

    for r in by_type.get("annotation", []):
        author = r.author or "Someone"
        preview = _meta(r).get("preview", "")
        default = f"✏️ New annotation from {author}" + (f": “{preview}”" if preview else "")
        lines.append(_line(tmpl, "annotation", {**base, "author": author, "preview": preview}, default))

    for r in by_type.get("collection", []):
        author = r.author or "Someone"
        name = _meta(r).get("name", "")
        default = f"🗂 {author} saved a selection" + (f" “{name}”" if name else "")
        lines.append(_line(tmpl, "collection", {**base, "author": author, "name": name}, default))

    uploads = by_type.get("upload", [])
    if uploads:
        n = sum(_meta(r).get("count", 1) for r in uploads)
        default = f"📤 {n} photo{'s' if n != 1 else ''} awaiting review"
        lines.append(_line(tmpl, "upload", {**base, "count": n}, default))

    downloads = by_type.get("download", [])
    if downloads:
        n = sum(_meta(r).get("count", 0) for r in downloads)
        photos = f" ({n} photo{'s' if n != 1 else ''})" if n else ""
        default = f"⬇️ {len(downloads)} download{'s' if len(downloads) != 1 else ''}{photos}"
        lines.append(_line(tmpl, "download", {**base, "count": len(downloads), "photos": n}, default))

    flags = by_type.get("flag", [])
    if flags:
        default = f"🚩 {len(flags)} photo{'s' if len(flags) != 1 else ''} flagged / liked / voted"
        lines.append(_line(tmpl, "flag", {**base, "count": len(flags)}, default))

    views = by_type.get("view", [])
    if views:
        default = f"👁 Gallery opened {len(views)}×"
        lines.append(_line(tmpl, "view", {**base, "count": len(views)}, default))

    lines = [ln for ln in lines if ln]
    title = _line(tmpl, "title", base, f"{instance_name} — {gallery_name}")
    return title, "\n".join(lines)


# ---- Flusher (background loop) ---------------------------------------------

def _flush_once() -> int:
    """Drain pending rows once. Returns the next sleep interval (seconds)."""
    db = SessionLocal()
    try:
        app = settings_repo.get(db)
        cfg = app.notifications or {}
        interval = int(cfg.get("flush_seconds") or 60)
        pending = notification_repo.list_pending(db)
        if not pending:
            return interval

        # Notifications turned off after rows were queued — drain silently so the outbox stays small.
        if not cfg.get("enabled"):
            notification_repo.mark_sent(db, [r.id for r in pending])
            return interval

        # Resolve each enabled channel to a built Apprise URL (preset → built, custom → raw);
        # drop any that don't resolve to a destination (incomplete config).
        channels = []
        for c in cfg.get("channels", []) or []:
            if not c.get("enabled"):
                continue
            built = presets.build_url(c.get("type", "custom"), c.get("params"), c.get("url", ""))
            # Drop targets refused by the opt-in internal-target guard so they aren't retried for
            # the full give-up window (apprise_client.send also backstops this).
            if built and url_guard.is_allowed(built):
                channels.append(built)
        by_gallery: dict[str, list] = defaultdict(list)
        for r in pending:
            by_gallery[r.gallery_id].append(r)

        now = datetime.now(timezone.utc)
        give_up_after = timedelta(seconds=max(600, interval * 10))
        sent_ids: list[str] = []

        templates = cfg.get("templates") or {}
        # Append the public gallery link only when there's an absolute base to resolve it against —
        # a relative /g/… link is unclickable in mail/push clients.
        link_base = (app.public_base_url or "").rstrip("/") if cfg.get("include_link", True) else ""

        for gallery_id, grows in by_gallery.items():
            gallery = gallery_repo.get_by_id(db, gallery_id)
            gname = gallery.name if gallery else "a gallery"
            title, body = _build_summary(app.instance_name, gname, grows, templates)
            if link_base and gallery:
                link = f"{link_base}/g/{gallery.share_token}"
                body = f"{body}\n\n🔗 {link}".lstrip("\n")

            any_ok = False
            for built in channels:
                any_ok = apprise_client.send(built, title, body) or any_ok

            oldest = grows[0].created_at
            if oldest.tzinfo is None:
                oldest = oldest.replace(tzinfo=timezone.utc)
            gave_up = (now - oldest) > give_up_after

            if any_ok or not channels or gave_up:
                if gave_up and not any_ok and channels:
                    _log.warning(
                        "Giving up on %d notification(s) for gallery %s after retries",
                        len(grows), gallery_id,
                    )
                sent_ids.extend(r.id for r in grows)
            # else: leave pending, retry next tick

        notification_repo.mark_sent(db, sent_ids)
        return interval
    finally:
        db.close()


async def run_flusher(stop_event: asyncio.Event) -> None:
    """Background loop: flush the outbox every ``flush_seconds`` until asked to stop."""
    loop = asyncio.get_event_loop()
    while not stop_event.is_set():
        try:
            interval = await loop.run_in_executor(None, _flush_once)
        except Exception:  # pragma: no cover - defensive
            _log.exception("notification flush tick failed")
            interval = 60
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(15, interval))
        except asyncio.TimeoutError:
            pass
