# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import logging
import os
import shutil
import threading

from PIL import Image as PilImage

from app.config import settings
from app.tasks.image_processing import (
    _auto_rotate,
    _save_resized,
    _to_srgb,
    original_needs_srgb,
    preview_targets,
)

logger = logging.getLogger(__name__)


def regenerate_missing_previews() -> None:
    """Synchronously (re)generate any missing/stale renditions from the originals.

    Same work as ``upgrade_previews_async`` but blocking — for callers that can't rely on a
    daemon thread outliving them (the CLI restore, where the process exits right after)."""
    _sync_previews()


def upgrade_previews_async() -> None:
    """Bring every rendition into line with the configured targets in a background thread.

    Runs on startup and whenever the high_res_previews setting changes: generates any rendition
    that's missing (e.g. the `small` tier on installs that predate it) and resizes any whose long
    edge doesn't match its target (in either direction, so switching the setting off also shrinks
    the files again). Idempotent and cheap when everything is already in sync (image header reads
    only).
    """
    threading.Thread(target=_sync_previews, name="preview-upgrade", daemon=True).start()


def _sync_previews() -> None:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models.image import Image
    from app.repositories import settings_repo

    db = SessionLocal()
    try:
        targets = preview_targets(settings_repo.get(db).high_res_previews)
        rows = db.execute(
            select(Image.gallery_id, Image.stored_filename, Image.width, Image.height).where(
                Image.processing_status == "done",
                Image.deleted_at.is_(None),
            )
        ).all()
    except Exception:
        logger.exception("Preview sync: could not list images")
        return
    finally:
        db.close()

    resized = {variant: 0 for variant in targets}
    stale_wm_dirs: set[str] = set()
    for gallery_id, stored_filename, width, height in rows:
        original_path = os.path.join(settings.upload_dir, gallery_id, "original", stored_filename)
        if not os.path.exists(original_path):
            continue
        # Lazily answered once per image (only when an untagged rendition forces the question):
        # is the original wide-gamut, so its pre-fix (untagged) renditions must be recoloured to sRGB?
        orig_wide = None
        for variant, (max_px, quality) in targets.items():
            path = os.path.join(settings.upload_dir, gallery_id, variant, stored_filename)
            # The rendition's long edge should be max_px, capped at the original's size.
            expected = max_px
            if width and height:
                expected = min(expected, max(width, height))
            try:
                if os.path.exists(path):
                    keep = False
                    try:
                        with PilImage.open(path) as current:
                            size_ok = max(current.size) == expected
                            tagged = current.info.get("icc_profile") is not None
                        if size_ok and tagged:
                            keep = True  # right size + already colour-managed (sRGB-tagged)
                        elif size_ok and not tagged:
                            # A pre-colour-fix rendition. Only recolour it if the original is
                            # wide-gamut; an untagged sRGB rendition already displays correctly.
                            if orig_wide is None:
                                orig_wide = original_needs_srgb(original_path)
                            keep = not orig_wide
                    except Exception:
                        # An existing rendition that won't open is corrupt/truncated → regenerate.
                        keep = False
                    if keep:
                        continue
                # Missing (e.g. a newly-added tier), wrong size, corrupt, or a wide-gamut source whose
                # rendition predates colour management → (re)generate, converting to sRGB.
                with PilImage.open(original_path) as orig:
                    _save_resized(
                        _to_srgb(_auto_rotate(orig), orig.info.get("icc_profile")),
                        max_px, path, quality=quality,
                    )
                resized[variant] += 1
                stale_wm_dirs.add(os.path.join(settings.upload_dir, gallery_id, f"{variant}-wm"))
            except Exception:
                logger.exception("Preview sync failed for %s/%s/%s", gallery_id, variant, stored_filename)

    # Drop watermarked caches built from the old renditions.
    for wm_dir in stale_wm_dirs:
        shutil.rmtree(wm_dir, ignore_errors=True)

    for variant, count in resized.items():
        if count:
            logger.info("Resized %d %s rendition(s) to %dpx", count, variant, targets[variant][0])
