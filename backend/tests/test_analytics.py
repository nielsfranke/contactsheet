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


# ---- windowing, deltas, reviewers, review status -------------------------------


def test_totals_are_windowed_with_previous_period(admin_client):
    g = make_gallery(admin_client, "Shoot")
    _seed(g["id"], "downloaded", days_ago=2, n=3)   # current 7d window
    _seed(g["id"], "downloaded", days_ago=10, n=2)  # previous 7d window
    _seed(g["id"], "downloaded", days_ago=40, n=5)  # outside both

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics?days=7").json()
    assert r["totals"]["downloads"] == 3
    assert r["previous_totals"]["downloads"] == 2

    # The instance rollup follows the same window.
    r = admin_client.get("/api/admin/analytics?days=7").json()
    assert r["totals"]["downloads"] == 3
    assert r["previous_totals"]["downloads"] == 2


def test_top_images_and_busiest_respect_window(admin_client):
    g = make_gallery(admin_client, "Old news", mode="collaboration")
    img = add_image(g["id"], filename="a.jpg")
    _seed(g["id"], "liked", image_id=img, days_ago=60, n=4)

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics?days=7").json()
    assert r["top_images"] == []
    assert admin_client.get("/api/admin/analytics?days=7").json()["busiest_galleries"] == []

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics?days=90").json()
    assert [t["image"]["id"] for t in r["top_images"]] == [img]


def test_engagement_series_sums_engagement_actions(admin_client):
    g = make_gallery(admin_client, "Shoot", mode="collaboration")
    img = add_image(g["id"])
    _seed(g["id"], "liked", image_id=img, n=2)
    _seed(g["id"], "commented", image_id=img, n=1)
    _seed(g["id"], "downloaded", n=5)  # not engagement

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics?days=7").json()
    series = r["engagement_series"]
    assert len(series) == 8
    assert sum(p["count"] for p in series) == 3
    assert series[-1]["count"] == 3


def test_top_reviewers_named_clients_only(admin_client):
    g = make_gallery(admin_client, "Shoot", mode="collaboration")
    img = add_image(g["id"])
    _seed(g["id"], "liked", author="Anna", image_id=img, n=3)
    _seed(g["id"], "commented", author="Anna", image_id=img, n=1)
    _seed(g["id"], "flagged", author="Ben", image_id=img, n=1)
    _seed(g["id"], "uploaded", author="Ben", n=1)
    _seed(g["id"], "viewed", author="Guest", n=9)      # anonymous
    _seed(g["id"], "approved", author="admin", n=2)    # photographer

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics").json()
    names = [x["name"] for x in r["top_reviewers"]]
    assert names == ["Anna", "Ben"]
    anna = r["top_reviewers"][0]
    assert anna["score"] == 4
    assert anna["breakdown"] == {"liked": 3, "commented": 1}
    assert anna["last_active"].endswith("Z") or "+" in anna["last_active"]
    assert r["top_reviewers"][1]["breakdown"] == {"flagged": 1, "uploaded": 1}

    inst = admin_client.get("/api/admin/analytics").json()
    assert [x["name"] for x in inst["top_reviewers"]] == ["Anna", "Ben"]


def test_review_status_snapshot(admin_client):
    from app.repositories import comment_repo, vote_repo

    g = make_gallery(admin_client, "Select", mode="collaboration", enable_team_voting=True)
    a = add_image(g["id"], filename="a.jpg")
    b = add_image(g["id"], filename="b.jpg")
    c = add_image(g["id"], filename="c.jpg")
    d = add_image(g["id"], filename="d.jpg")
    gone = add_image(g["id"], filename="gone.jpg")

    db = SessionLocal()
    try:
        image_repo.update_fields(db, image_repo.get_by_id(db, a), color_flag="green", rating=4)
        image_repo.update_fields(db, image_repo.get_by_id(db, b), color_flag="red")
        image_repo.update_fields(db, image_repo.get_by_id(db, gone), color_flag="green")
        image_repo.soft_delete(db, image_repo.get_by_id(db, gone))
        vote_repo.upsert(db, c, g["id"], "Anna", color_flag="green")
        vote_repo.upsert(db, c, g["id"], "Ben", rating=5)
        comment_repo.create(db, image_id=c, author_name="Ben", text="nice")
    finally:
        db.close()

    r = admin_client.get(f"/api/galleries/{g['id']}/analytics").json()
    st = r["review_status"]
    assert st["images"] == 4                       # soft-deleted excluded
    assert st["flags"] == {"none": 2, "green": 1, "red": 1, "yellow": 0, "blue": 0}
    assert st["ratings"] == [3, 0, 0, 0, 1, 0]     # index = stars; unrated counted at 0
    assert st["reviewed"] == 3                     # a (flag), b (flag), c (votes + comment); d untouched
    assert st["commented"] == 1
    assert st["voters"] == 2
    assert st["liked"] == 0


def test_busiest_galleries_carry_engagement(admin_client):
    g = make_gallery(admin_client, "Busy", mode="collaboration")
    img = add_image(g["id"])
    _seed(g["id"], "downloaded", n=2)
    _seed(g["id"], "liked", image_id=img, n=3)

    r = admin_client.get("/api/admin/analytics").json()
    top = r["busiest_galleries"][0]
    assert top["gallery_id"] == g["id"]
    assert top["score"] == 5
    assert top["engagement"] == 3
