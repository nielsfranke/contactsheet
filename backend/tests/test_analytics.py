# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Analytics read-model: per-gallery + instance aggregates over the activities table."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.repositories import activity_repo, image_repo
from tests.helpers import add_image, make_gallery


def _seed(gallery_id, action, author="Guest", image_id=None, ip=None, days_ago=0, n=1):
    db = SessionLocal()
    try:
        for _ in range(n):
            a = activity_repo.log(db, gallery_id, action, author, image_id=image_id, ip=ip)
            if days_ago:
                a.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
                db.add(a)
                db.commit()
    finally:
        db.close()


def test_gallery_analytics_totals_and_top_images(admin_client):
    g = make_gallery(admin_client, "Shoot", mode="collaboration")
    img_a = add_image(g["id"], filename="a.jpg")
    img_b = add_image(g["id"], filename="b.jpg")

    _seed(g["id"], "downloaded", n=2)
    _seed(g["id"], "liked", image_id=img_a, n=3)
    _seed(g["id"], "flagged", image_id=img_a, n=1)
    _seed(g["id"], "commented", image_id=img_b, n=1)

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics")
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["totals"]["downloads"] == 2
    assert data["totals"]["likes"] == 3
    assert data["totals"]["flags"] == 1
    assert data["totals"]["comments"] == 1

    # Top photos ranked by engagement: img_a (4) before img_b (1).
    top = data["top_images"]
    assert [t["image"]["id"] for t in top] == [img_a, img_b]
    assert top[0]["score"] == 4
    assert top[0]["breakdown"]["liked"] == 3


def test_views_unavailable_when_ip_logging_off(admin_client):
    g = make_gallery(admin_client, "Shoot")
    r = admin_client.get(f"/api/galleries/{g['id']}/analytics").json()
    assert r["views_available"] is False
    assert r["recent_visitors"] == []


def test_views_available_with_ip_logging(admin_client):
    admin_client.patch("/api/admin/settings", json={"activity_ip_logging": True})
    g = make_gallery(admin_client, "Shoot")
    _seed(g["id"], "viewed", ip="203.0.113.5", n=2)

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics").json()
    assert r["views_available"] is True
    assert r["totals"]["views"] == 2
    assert len(r["recent_visitors"]) == 2
    assert r["recent_visitors"][0]["ip"] == "203.0.113.5"


def test_timeseries_zero_filled(admin_client):
    g = make_gallery(admin_client, "Shoot")
    _seed(g["id"], "downloaded", days_ago=2, n=1)
    _seed(g["id"], "downloaded", days_ago=0, n=3)

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics?days=7").json()
    series = r["downloads_series"]
    # One contiguous point per day — gaps filled with zero.
    assert len(series) == 8  # since(7d ago) .. today inclusive
    assert sum(p["count"] for p in series) == 4
    assert series[-1]["count"] == 3


def test_soft_deleted_image_excluded_from_top(admin_client):
    g = make_gallery(admin_client, "Shoot", mode="collaboration")
    img = add_image(g["id"], filename="gone.jpg")
    _seed(g["id"], "liked", image_id=img, n=5)

    db = SessionLocal()
    try:
        image_repo.soft_delete(db, image_repo.get_by_id(db, img))
    finally:
        db.close()

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics").json()
    assert r["top_images"] == []


def test_gallery_analytics_404(admin_client):
    assert admin_client.get("/api/galleries/nope/analytics").status_code == 404


def test_analytics_requires_admin(admin_client):
    g = make_gallery(admin_client, "Shoot")
    anon = TestClient(app)
    assert anon.get(f"/api/galleries/{g['id']}/analytics").status_code == 401
    assert anon.get("/api/admin/analytics").status_code == 401


def test_instance_analytics_busiest(admin_client):
    g1 = make_gallery(admin_client, "Busy")
    g2 = make_gallery(admin_client, "Quiet")
    _seed(g1["id"], "downloaded", n=5)
    _seed(g2["id"], "downloaded", n=1)

    r = admin_client.get("/api/admin/analytics").json()
    assert r["totals"]["downloads"] == 6
    busiest = r["busiest_galleries"]
    assert busiest[0]["gallery_id"] == g1["id"]
    assert busiest[0]["score"] == 5
