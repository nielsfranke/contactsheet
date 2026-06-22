# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Background indexing for semantic search.

Each image is encoded once (on upload, or during a backfill) on a small, dedicated thread pool so
indexing can never starve HTTP or the image-rendering pool on a modest CPU box. The actual model
inference happens in the `contactsheet-ml` sidecar; this task just orchestrates: pick the file,
call the embedder, store the vector, update `embedding_status`.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from app.config import settings
from app.database import SessionLocal
from app.ml import embedder
from app.repositories import image_embedding_repo, image_repo, settings_repo
from app.storage import format_detect

logger = logging.getLogger(__name__)

# Deliberately small (default 2). Indexing is best-effort background work; it must yield to serving.
_executor = ThreadPoolExecutor(max_workers=settings.embed_workers, thread_name_prefix="embed")

DEFAULT_MODEL = "siglip2-base-multilingual"


def _active_config(db) -> tuple[str, bool] | None:
    """(model, index_originals) when search is enabled and a sidecar is configured, else None."""
    if not embedder.is_configured():
        return None
    cfg = settings_repo.get(db).semantic_search or {}
    if not cfg.get("enabled"):
        return None
    return cfg.get("model", DEFAULT_MODEL), bool(cfg.get("index_originals", True))


def _source_path(gallery_id: str, stored_filename: str, use_original: bool) -> str:
    # The sidecar resizes to model resolution regardless, so the medium rendition is the cheap
    # default (a few hundred KB vs. a multi-MB original) with negligible quality loss for CLIP.
    variant = "original" if use_original else "medium"
    return os.path.join(settings.upload_dir, gallery_id, variant, stored_filename)


def _use_original(stored_filename: str, index_originals: bool) -> bool:
    # Honor the setting only when the sidecar (plain Pillow) can actually read the original. Camera
    # RAW and PSD can't be read from the original, so they're always indexed from the `medium` JPEG
    # rendition — for RAW that rendition is the embedded camera preview, which is the best readable
    # representation we have (no demosaic), so this is correct rather than a downgrade.
    return index_originals and format_detect.ml_can_read_original(stored_filename)


def embed_one(image_id: str) -> None:
    """Encode and store the vector for a single image. Safe to call when the feature is off
    (no-ops). Never raises — failures are recorded as `embedding_status='error'`."""
    db = SessionLocal()
    try:
        config = _active_config(db)
        if config is None:
            return
        model, index_originals = config

        image = image_repo.get_by_id(db, image_id)
        if image is None:
            return
        if image.is_video or format_detect.is_psb_filename(image.stored_filename):
            # PSB is excluded from search — its only readable pixels are a tiny embedded thumbnail.
            image_repo.set_embedding_status(db, image_id, "skipped")
            return

        use_original = _use_original(image.stored_filename, index_originals)
        path = _source_path(image.gallery_id, image.stored_filename, use_original)
        if not use_original and not os.path.exists(path) and \
                format_detect.ml_can_read_original(image.stored_filename):
            # Medium not generated yet (e.g. very fresh upload) — fall back to the original, but only
            # when the sidecar can read it (never for RAW/PSD, whose original is unreadable).
            path = _source_path(image.gallery_id, image.stored_filename, True)

        try:
            vector = embedder.embed_image(path, model)
        except embedder.EmbedderError as exc:
            logger.warning("Embedding failed for image %s: %s", image_id, exc)
            image_repo.set_embedding_status(db, image_id, "error")
            return

        image_embedding_repo.upsert(db, image_id, model, vector)
        image_repo.set_embedding_status(db, image_id, "indexed")
        logger.debug("Indexed image %s (model=%s)", image_id, model)
    except Exception:
        logger.exception("Unexpected error indexing image %s", image_id)
    finally:
        db.close()


def submit(image_id: str) -> None:
    """Enqueue one image for indexing (returns immediately). No-op if the pool can't take it."""
    try:
        _executor.submit(embed_one, image_id)
    except RuntimeError:
        # Pool shut down (e.g. during tests/teardown) — drop silently.
        pass


def run_backfill() -> None:
    """Submit every image that still needs indexing. Cheap to call repeatedly — it only picks up
    rows in 'pending'/'error'. Triggered when search is enabled or the model changes."""
    db = SessionLocal()
    try:
        if _active_config(db) is None:
            return
        ids = image_repo.ids_needing_embedding(db)
    finally:
        db.close()
    logger.info("Semantic-search backfill: queueing %d image(s)", len(ids))
    for image_id in ids:
        submit(image_id)
