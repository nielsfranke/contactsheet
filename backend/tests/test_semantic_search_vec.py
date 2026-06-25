# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""sqlite-vec acceleration for instance-wide semantic search.

The vec0 index must rank identically to the NumPy path, exclude soft-deleted images, and degrade to
NumPy on any failure. Gallery-scoped search deliberately stays on NumPy. See app/vector_index.py +
docs/architecture/semantic-search-scale.md."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import update

from app.config import settings as cfg
from app.database import SessionLocal, engine
from app.models.image import Image
from app.repositories import image_embedding_repo
from tests.helpers import add_image, make_gallery

MODEL = "siglip2-base-multilingual"


@pytest.fixture
def vec_backend(monkeypatch):
    """Turn on the sqlite-vec backend and force fresh connections that load the extension. Skips if
    the extension can't load on this build. Disposes the pool afterwards so later tests are clean."""
    try:
        import sqlite_vec  # noqa: F401
    except Exception:
        pytest.skip("sqlite-vec not installed")

    monkeypatch.setattr(cfg, "semantic_search_vec", True)
    engine.dispose()  # new connections will run the connect hook with the flag on

    from app import vector_index

    db = SessionLocal()
    try:
        if not vector_index.available(db):
            pytest.skip("sqlite-vec could not be loaded on this SQLite build")
    finally:
        db.close()

    yield
    engine.dispose()  # drop extension-loaded connections before the next test


def _seed(gallery_id: str) -> dict[str, str]:
    """Three images with known orthogonal-ish vectors → deterministic ranking for query [1,0,0,0]."""
    ids = {
        "a": add_image(gallery_id, filename="a.jpg"),  # [1,0,0,0]  → cos 1.0
        "c": add_image(gallery_id, filename="c.jpg"),  # [.7,.7,..] → cos ~0.707
        "b": add_image(gallery_id, filename="b.jpg"),  # [0,1,0,0]  → cos 0.0
    }
    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, ids["a"], MODEL, [1.0, 0.0, 0.0, 0.0])
        image_embedding_repo.upsert(db, ids["b"], MODEL, [0.0, 1.0, 0.0, 0.0])
        image_embedding_repo.upsert(db, ids["c"], MODEL, [0.7, 0.7, 0.0, 0.0])
    finally:
        db.close()
    return ids


def test_vec_global_search_ranks_like_numpy(admin_client, vec_backend):
    g = make_gallery(admin_client, "G")
    ids = _seed(g["id"])

    db = SessionLocal()
    try:
        from app import vector_index
        assert vector_index.available(db)  # we are really exercising the vec path

        ranked = image_embedding_repo.search(db, [1.0, 0.0, 0.0, 0.0], MODEL)  # global (no scope)
    finally:
        db.close()

    order = [image_id for image_id, _ in ranked]
    assert order == [ids["a"], ids["c"], ids["b"]]
    assert ranked[0][1] == pytest.approx(1.0, abs=1e-5)
    # Descending similarity.
    assert ranked[0][1] >= ranked[1][1] >= ranked[2][1]


def test_vec_global_search_excludes_soft_deleted(admin_client, vec_backend):
    g = make_gallery(admin_client, "G")
    ids = _seed(g["id"])

    db = SessionLocal()
    try:
        db.execute(update(Image).where(Image.id == ids["c"]).values(deleted_at=datetime.now(timezone.utc)))
        db.commit()
        ranked = image_embedding_repo.search(db, [1.0, 0.0, 0.0, 0.0], MODEL)
    finally:
        db.close()

    returned = {image_id for image_id, _ in ranked}
    assert ids["c"] not in returned
    assert returned == {ids["a"], ids["b"]}


def test_falls_back_to_numpy_when_vec_errors(admin_client, vec_backend, monkeypatch):
    g = make_gallery(admin_client, "G")
    ids = _seed(g["id"])

    # Make the vec path blow up → search must still return correct results via NumPy.
    from app import vector_index
    monkeypatch.setattr(vector_index, "search_global", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))

    db = SessionLocal()
    try:
        ranked = image_embedding_repo.search(db, [1.0, 0.0, 0.0, 0.0], MODEL)
    finally:
        db.close()

    assert [image_id for image_id, _ in ranked] == [ids["a"], ids["c"], ids["b"]]
