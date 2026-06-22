# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Semantic content search.

The ML inference (the `contactsheet-ml` sidecar) is stubbed throughout — these tests exercise the
deterministic halves we own: the vector store + cosine ranking, gallery-scoped search, settings
persistence/validation, the enable/model-swap re-index trigger, and API auth/availability gating.
"""

import math

import pytest

from app.database import SessionLocal
from app.ml import embedder
from app.repositories import gallery_repo, image_embedding_repo, image_repo, settings_repo
from app.services import semantic_search_service
from app.tasks import embed_task
from tests.helpers import add_image, make_gallery

MODEL = "siglip2-base-multilingual"


def _enable(threshold: float = 0.0, model: str = MODEL) -> None:
    """Turn the feature on directly in the DB (bypasses the router's re-index trigger)."""
    db = SessionLocal()
    try:
        settings_repo.update(
            db,
            semantic_search={
                "enabled": True,
                "model": model,
                "default_threshold": threshold,
                "index_originals": True,
            },
        )
    finally:
        db.close()


# --- vector store + ranking -------------------------------------------------------------------

def test_upsert_normalizes_and_search_ranks_by_cosine(admin_client):
    gallery = make_gallery(admin_client, name="G")
    a = add_image(gallery["id"], filename="a.jpg")  # parallel to the query
    b = add_image(gallery["id"], filename="b.jpg")  # orthogonal
    c = add_image(gallery["id"], filename="c.jpg")  # 45°

    db = SessionLocal()
    try:
        # Deliberately un-normalized inputs — upsert must L2-normalize them.
        image_embedding_repo.upsert(db, a, MODEL, [10.0, 0.0, 0.0, 0.0])
        image_embedding_repo.upsert(db, b, MODEL, [0.0, 5.0, 0.0, 0.0])
        image_embedding_repo.upsert(db, c, MODEL, [3.0, 3.0, 0.0, 0.0])

        ranked = image_embedding_repo.search(db, [1.0, 0.0, 0.0, 0.0], MODEL)
        ids = [iid for iid, _ in ranked]
        scores = {iid: score for iid, score in ranked}

        assert ids == [a, c, b]                       # cosine order
        assert scores[a] == pytest.approx(1.0, abs=1e-5)
        assert scores[b] == pytest.approx(0.0, abs=1e-5)
        assert scores[c] == pytest.approx(math.sqrt(0.5), abs=1e-5)
    finally:
        db.close()


def test_search_is_scoped_to_gallery_ids(admin_client):
    g1 = make_gallery(admin_client, name="One")
    g2 = make_gallery(admin_client, name="Two")
    i1 = add_image(g1["id"], filename="1.jpg")
    i2 = add_image(g2["id"], filename="2.jpg")

    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, i1, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, i2, MODEL, [1.0, 0.0])

        scoped = image_embedding_repo.search(db, [1.0, 0.0], MODEL, gallery_ids=[g1["id"]])
        assert [iid for iid, _ in scoped] == [i1]

        assert image_embedding_repo.search(db, [1.0, 0.0], MODEL, gallery_ids=[]) == []
    finally:
        db.close()


def test_search_excludes_soft_deleted(admin_client):
    g = make_gallery(admin_client, name="G")
    keep = add_image(g["id"], filename="keep.jpg")
    gone = add_image(g["id"], filename="gone.jpg")

    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, keep, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, gone, MODEL, [1.0, 0.0])
        image_repo.soft_delete(db, image_repo.get_by_id(db, gone))

        ranked = image_embedding_repo.search(db, [1.0, 0.0], MODEL)
        assert [iid for iid, _ in ranked] == [keep]
    finally:
        db.close()


def test_search_ignores_other_model_vectors(admin_client):
    g = make_gallery(admin_client, name="G")
    img = add_image(g["id"], filename="x.jpg")
    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, img, "old-model", [1.0, 0.0])
        assert image_embedding_repo.search(db, [1.0, 0.0], MODEL) == []
        assert image_embedding_repo.search(db, [1.0, 0.0], "old-model") == [
            (img, pytest.approx(1.0, abs=1e-5))
        ]
    finally:
        db.close()


def test_orphans_from_deleted_gallery_are_excluded(admin_client):
    """A soft-deleted gallery keeps its image rows (own deleted_at stays NULL) but its files are
    gone. Those orphans must not be queued for indexing, counted, or returned by search."""
    live = make_gallery(admin_client, name="Live")
    doomed = make_gallery(admin_client, name="Doomed")
    live_img = add_image(live["id"], filename="live.jpg")
    orphan = add_image(doomed["id"], filename="orphan.jpg")

    db = SessionLocal()
    try:
        # Both start indexable; the orphan even has a vector already.
        image_embedding_repo.upsert(db, live_img, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, orphan, MODEL, [1.0, 0.0])
        image_repo.set_embedding_status(db, orphan, "error")

        # Soft-delete the gallery (cascade marks the gallery, not each image row).
        gallery_repo.soft_delete(db, gallery_repo.get_by_id(db, doomed["id"]))

        # Backfill no longer sees the orphan…
        assert image_repo.ids_needing_embedding(db) == [live_img]
        # …the settings panel doesn't count it as a failure…
        counts = image_repo.embedding_status_counts(db)
        assert counts.get("error", 0) == 0
        # …and it can't surface in search.
        ranked = image_embedding_repo.search(db, [1.0, 0.0], MODEL)
        assert [iid for iid, _ in ranked] == [live_img]
    finally:
        db.close()


# --- service: query path ----------------------------------------------------------------------

def test_service_search_applies_threshold(admin_client, monkeypatch):
    g = make_gallery(admin_client, name="G")
    near = add_image(g["id"], filename="near.jpg")
    far = add_image(g["id"], filename="far.jpg")

    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, near, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, far, MODEL, [0.0, 1.0])
    finally:
        db.close()

    _enable(threshold=0.5)
    monkeypatch.setattr(embedder, "is_configured", lambda: True)
    monkeypatch.setattr(embedder, "embed_text", lambda text, model: [1.0, 0.0])

    db = SessionLocal()
    try:
        ranked = semantic_search_service.search(db, g["id"], "anything")
        assert [iid for iid, _ in ranked] == [near]   # far one filtered by the 0.5 cutoff
        # An explicit lower threshold widens the net.
        ranked_all = semantic_search_service.search(db, g["id"], "anything", threshold=0.0)
        assert set(iid for iid, _ in ranked_all) == {near, far}
    finally:
        db.close()


def test_service_search_raises_when_disabled(admin_client, monkeypatch):
    monkeypatch.setattr(embedder, "is_configured", lambda: True)
    db = SessionLocal()
    try:
        with pytest.raises(semantic_search_service.SearchUnavailable):
            semantic_search_service.search(db, None, "cat")
    finally:
        db.close()


# --- settings persistence + validation --------------------------------------------------------

def test_settings_roundtrip_and_validation(admin_client, monkeypatch):
    # Don't actually kick a backfill when the router persists the change.
    monkeypatch.setattr("app.services.semantic_search_service.embed_task.run_backfill", lambda: None)

    r = admin_client.patch("/api/admin/settings", json={
        "semantic_search": {"enabled": True, "model": MODEL, "default_threshold": 0.3}
    })
    assert r.status_code == 200, r.text
    body = r.json()["semantic_search"]
    assert body["enabled"] is True and body["default_threshold"] == 0.3

    # Persisted across a fresh GET.
    assert admin_client.get("/api/admin/settings").json()["semantic_search"]["model"] == MODEL

    # Out-of-range threshold and unknown keys are rejected.
    assert admin_client.patch("/api/admin/settings", json={
        "semantic_search": {"enabled": True, "default_threshold": 2.0}
    }).status_code == 422
    assert admin_client.patch("/api/admin/settings", json={
        "semantic_search": {"enabled": True, "bogus": 1}
    }).status_code == 422

    # Explicit null clears it.
    assert admin_client.patch("/api/admin/settings", json={"semantic_search": None}).status_code == 200
    assert admin_client.get("/api/admin/settings").json()["semantic_search"] is None


def test_enabling_triggers_backfill(admin_client, monkeypatch):
    calls = []
    monkeypatch.setattr("app.services.semantic_search_service.embed_task.run_backfill",
                        lambda: calls.append(True))
    r = admin_client.patch("/api/admin/settings", json={
        "semantic_search": {"enabled": True, "model": MODEL}
    })
    assert r.status_code == 200
    assert calls == [True]


def test_model_swap_requeues_library(admin_client, monkeypatch):
    monkeypatch.setattr(embed_task, "run_backfill", lambda: None)
    g = make_gallery(admin_client, name="G")
    img = add_image(g["id"], filename="x.jpg")

    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, img, "old-model", [1.0, 0.0])
        image_repo.set_embedding_status(db, img, "indexed")

        semantic_search_service.on_settings_change(
            db,
            {"enabled": True, "model": "old-model"},
            {"enabled": True, "model": MODEL},
        )
        # Old vectors dropped; the image is re-queued.
        assert image_embedding_repo.count_for_model(db, "old-model") == 0
        assert image_repo.get_by_id(db, img).embedding_status == "pending"
    finally:
        db.close()


# --- API gating -------------------------------------------------------------------------------

def test_search_endpoint_requires_admin(client):
    r = client.get("/api/galleries/whatever/search", params={"q": "cat"})
    assert r.status_code == 401


def test_search_endpoint_503_when_unavailable(admin_client):
    g = make_gallery(admin_client, name="G")
    # Feature off → search is unavailable, not a 500.
    r = admin_client.get(f"/api/galleries/{g['id']}/search", params={"q": "cat"})
    assert r.status_code == 503


def test_global_search_spans_galleries_with_context(admin_client, monkeypatch):
    g1 = make_gallery(admin_client, name="Rome")
    g2 = make_gallery(admin_client, name="Paris")
    rome = add_image(g1["id"], filename="rome.jpg")
    paris = add_image(g2["id"], filename="paris.jpg")
    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, rome, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, paris, MODEL, [0.6, 0.2])
    finally:
        db.close()

    _enable(threshold=0.0)
    monkeypatch.setattr(embedder, "is_configured", lambda: True)
    monkeypatch.setattr(embedder, "embed_text", lambda text, model: [1.0, 0.0])

    r = admin_client.get("/api/search", params={"q": "city"})
    assert r.status_code == 200, r.text
    hits = r.json()
    # Spans both galleries, ranked, each tagged with its gallery name + share token.
    assert [h["id"] for h in hits] == [rome, paris]
    by_id = {h["id"]: h for h in hits}
    assert by_id[rome]["gallery_name"] == "Rome"
    assert by_id[paris]["gallery_name"] == "Paris"
    assert by_id[rome]["gallery_share_token"]


def test_all_photos_browse_paginates_with_context(admin_client):
    g1 = make_gallery(admin_client, name="Rome")
    g2 = make_gallery(admin_client, name="Paris")
    for i in range(3):
        add_image(g1["id"], filename=f"a{i}.jpg")
    add_image(g2["id"], filename="b0.jpg")

    # Browse is independent of the ML feature (no enable / sidecar needed).
    r = admin_client.get("/api/photos", params={"sort": "name", "dir": "asc", "limit": 2, "offset": 0})
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["total"] == 4
    assert len(page["items"]) == 2
    # Each item carries gallery context for the badge.
    assert all("gallery_name" in it and it["gallery_name"] in {"Rome", "Paris"} for it in page["items"])
    # Second page returns the remainder.
    r2 = admin_client.get("/api/photos", params={"sort": "name", "dir": "asc", "limit": 2, "offset": 2})
    assert len(r2.json()["items"]) == 2


def test_all_photos_filename_filter(admin_client):
    g = make_gallery(admin_client, name="G")
    add_image(g["id"], filename="sunset_beach.jpg")
    add_image(g["id"], filename="city_night.jpg")
    add_image(g["id"], filename="beach_house.jpg")

    r = admin_client.get("/api/photos", params={"q": "beach"})
    assert r.status_code == 200, r.text
    names = {it["original_filename"] for it in r.json()["items"]}
    assert names == {"sunset_beach.jpg", "beach_house.jpg"}
    assert r.json()["total"] == 2


def test_all_photos_filter_matches_gallery_name(admin_client):
    rome = make_gallery(admin_client, name="Rome")
    paris = make_gallery(admin_client, name="Paris")
    add_image(rome["id"], filename="DSC_1.jpg")  # filename gives nothing away
    add_image(rome["id"], filename="DSC_2.jpg")
    add_image(paris["id"], filename="DSC_3.jpg")

    # "rome" finds the gallery's photos by gallery name alone.
    r = admin_client.get("/api/photos", params={"q": "rome"})
    assert r.status_code == 200, r.text
    assert {it["original_filename"] for it in r.json()["items"]} == {"DSC_1.jpg", "DSC_2.jpg"}


def test_all_photos_filter_matches_iptc_values_not_keys(admin_client):
    import json
    g = make_gallery(admin_client, name="G")
    tagged = add_image(g["id"], filename="DSC_0001.jpg")
    add_image(g["id"], filename="DSC_0002.jpg")  # no IPTC

    db = SessionLocal()
    try:
        img = image_repo.get_by_id(db, tagged)
        image_repo.update_fields(
            db, img,
            iptc_data=json.dumps({"keywords": ["Hochzeit", "Müller"], "city": "Berlin"}, ensure_ascii=False),
        )
    finally:
        db.close()

    # A keyword value matches even though the filename is meaningless.
    r = admin_client.get("/api/photos", params={"q": "Müller"})
    assert {it["id"] for it in r.json()["items"]} == {tagged}
    # A location value matches too.
    assert {it["id"] for it in admin_client.get("/api/photos", params={"q": "berlin"}).json()["items"]} == {tagged}
    # A JSON *key* name ("keywords"/"city") must NOT match — we search values, not field names.
    assert admin_client.get("/api/photos", params={"q": "keywords"}).json()["total"] == 0
    assert admin_client.get("/api/photos", params={"q": "city"}).json()["total"] == 0


def test_all_photos_requires_admin(client):
    assert client.get("/api/photos").status_code == 401


def test_global_search_requires_admin(client):
    assert client.get("/api/search", params={"q": "cat"}).status_code == 401


def test_global_search_503_when_off(admin_client):
    # Feature off → unavailable, not a 500.
    assert admin_client.get("/api/search", params={"q": "cat"}).status_code == 503


def test_search_endpoint_returns_ranked_images(admin_client, monkeypatch):
    g = make_gallery(admin_client, name="G")
    near = add_image(g["id"], filename="near.jpg")
    far = add_image(g["id"], filename="far.jpg")
    db = SessionLocal()
    try:
        image_embedding_repo.upsert(db, near, MODEL, [1.0, 0.0])
        image_embedding_repo.upsert(db, far, MODEL, [0.2, 1.0])
    finally:
        db.close()

    _enable(threshold=0.0)
    monkeypatch.setattr(embedder, "is_configured", lambda: True)
    monkeypatch.setattr(embedder, "embed_text", lambda text, model: [1.0, 0.0])

    r = admin_client.get(f"/api/galleries/{g['id']}/search", params={"q": "sunset"})
    assert r.status_code == 200, r.text
    ids = [img["id"] for img in r.json()]
    assert ids == [near, far]                      # ranked, most-similar first


# --- Broad-format indexing: RAW/PSD embed from the rendition, not the unreadable original --------

def test_use_original_honored_for_pillow_formats():
    # JPEG/TIFF originals are readable by the sidecar → honor index_originals.
    assert embed_task._use_original("a.jpg", index_originals=True) is True
    assert embed_task._use_original("a.tif", index_originals=True) is True
    # …and medium when the setting is off.
    assert embed_task._use_original("a.jpg", index_originals=False) is False


def test_raw_and_psd_always_index_from_rendition():
    # The sidecar's plain Pillow can't read these originals → never use the original.
    for name in ("shot.cr2", "shot.cr3", "shot.nef", "shot.arw", "art.psd"):
        assert embed_task._use_original(name, index_originals=True) is False


def test_source_path_points_at_medium_for_raw():
    p = embed_task._source_path("gid", "x.cr2", embed_task._use_original("x.cr2", True))
    assert "/medium/" in p and p.endswith("x.cr2")  # JPEG bytes stored under the raw's name
    p_jpg = embed_task._source_path("gid", "x.jpg", embed_task._use_original("x.jpg", True))
    assert "/original/" in p_jpg
