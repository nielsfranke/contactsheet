# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Orchestration for semantic content search.

Three jobs:
- react to settings changes (enable / model swap → (re)queue the library for indexing),
- run a query (encode text → vector KNN → threshold → ranked image ids),
- report index status for the admin settings panel.

The heavy lifting lives elsewhere: inference in the `contactsheet-ml` sidecar (via `ml.embedder`),
vector storage + ranking in `image_embedding_repo`, indexing on the `embed_task` thread pool.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.ml import embedder
from app.repositories import gallery_repo, image_embedding_repo, image_repo, settings_repo
from app.tasks import embed_task

logger = logging.getLogger(__name__)

DEFAULT_MODEL = embed_task.DEFAULT_MODEL


class SearchUnavailable(Exception):
    """Search was requested but the feature is off, unconfigured, or the sidecar is unreachable."""


def _config(db: Session) -> dict:
    return settings_repo.get(db).semantic_search or {}


def on_settings_change(db: Session, before: dict | None, after: dict | None) -> None:
    """Handle a change to the semantic-search settings blob.

    - Disabling (or clearing) is a no-op: stored vectors are simply ignored, kept for a fast re-enable.
    - First enable: existing images already sit at `embedding_status='pending'`, so a backfill picks
      them up as-is.
    - Model swap (while enabled): drop vectors from the old encoder and re-queue the whole library,
      then backfill.
    """
    after = after or {}
    if not after.get("enabled"):
        return

    new_model = after.get("model", DEFAULT_MODEL)
    before = before or {}
    old_model = before.get("model")
    if before.get("enabled") and old_model and old_model != new_model:
        removed = image_embedding_repo.delete_for_model_mismatch(db, new_model)
        image_repo.reset_embedding_status(db)
        logger.info("Encoder changed %s → %s: dropped %d vector(s), re-queueing library",
                    old_model, new_model, removed)

    # If the sqlite-vec backend is on, (re)build its index from the authoritative BLOBs so existing
    # vectors are queryable immediately (and a changed model's dim is picked up). Best-effort: a
    # failure leaves the NumPy path in charge.
    from app import vector_index

    if vector_index.enabled():
        try:
            vector_index.rebuild(db, new_model)
        except Exception:
            logger.warning("sqlite-vec rebuild failed; relying on the NumPy path", exc_info=True)

    embed_task.run_backfill()


def search(
    db: Session,
    gallery_id: str | None,
    query: str,
    threshold: float | None = None,
    limit: int = 200,
) -> list[tuple[str, float]]:
    """Ranked (image_id, score) pairs for a text query, scoped to a gallery subtree (or the whole
    instance when `gallery_id` is None). Scores below the threshold are dropped."""
    cfg = _config(db)
    if not cfg.get("enabled") or not embedder.is_configured():
        raise SearchUnavailable("Semantic search is not enabled")

    query = (query or "").strip()
    if not query:
        return []

    model = cfg.get("model", DEFAULT_MODEL)
    thr = threshold if threshold is not None else float(cfg.get("default_threshold", 0.08))

    try:
        query_vec = embedder.embed_text(query, model)
    except embedder.EmbedderError as exc:
        raise SearchUnavailable(str(exc)) from exc

    gallery_ids = gallery_repo.descendant_ids(db, gallery_id) if gallery_id else None
    ranked = image_embedding_repo.search(db, query_vec, model, gallery_ids=gallery_ids, limit=limit)
    return [(image_id, score) for image_id, score in ranked if score >= thr]


def status(db: Session) -> dict:
    """Index progress + sidecar health for the admin settings panel."""
    cfg = _config(db)
    counts = image_repo.embedding_status_counts(db)
    return {
        "enabled": bool(cfg.get("enabled")),
        "configured": embedder.is_configured(),
        "model": cfg.get("model", DEFAULT_MODEL),
        "default_threshold": float(cfg.get("default_threshold", 0.08)),
        "sidecar": embedder.health(),
        "indexed": counts.get("indexed", 0),
        "pending": counts.get("pending", 0),
        "error": counts.get("error", 0),
        "skipped": counts.get("skipped", 0),
        "total": sum(counts.values()),
    }
