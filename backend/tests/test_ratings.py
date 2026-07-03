# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Star ratings: instance rating_mode switch, shared rate endpoint, per-reviewer star votes."""

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import add_image, make_gallery


def _pub() -> TestClient:
    return TestClient(app)


def test_rating_mode_round_trips(admin_client):
    assert admin_client.get("/api/admin/settings").json()["rating_mode"] == "flags"
    r = admin_client.patch("/api/admin/settings", json={"rating_mode": "stars"})
    assert r.status_code == 200 and r.json()["rating_mode"] == "stars"
    # Public gallery response advertises the mode so the client knows what to render.
    g = make_gallery(admin_client, "Show", mode="collaboration")
    pub = _pub().get(f"/api/public/g/{g['share_token']}").json()
    assert pub["rating_mode"] == "stars"


def test_rating_mode_both_round_trips(admin_client):
    r = admin_client.patch("/api/admin/settings", json={"rating_mode": "both"})
    assert r.status_code == 200 and r.json()["rating_mode"] == "both"
    g = make_gallery(admin_client, "Both", mode="collaboration")
    pub = _pub().get(f"/api/public/g/{g['share_token']}").json()
    assert pub["rating_mode"] == "both"


def test_rating_mode_rejects_unknown(admin_client):
    assert admin_client.patch("/api/admin/settings", json={"rating_mode": "hearts"}).status_code == 422


def test_public_rate_sets_shared_rating(admin_client):
    g = make_gallery(admin_client, "Collab", mode="collaboration")
    img = add_image(g["id"])
    r = _pub().post(f"/api/public/g/{g['share_token']}/images/{img}/rate", json={"rating": 4})
    assert r.status_code == 200 and r.json()["rating"] == 4
    # 0 clears it back to unrated.
    r = _pub().post(f"/api/public/g/{g['share_token']}/images/{img}/rate", json={"rating": 0})
    assert r.json()["rating"] == 0


def test_public_rate_clamps_range(admin_client):
    g = make_gallery(admin_client, "Collab", mode="collaboration")
    img = add_image(g["id"])
    assert _pub().post(f"/api/public/g/{g['share_token']}/images/{img}/rate", json={"rating": 6}).status_code == 422


def test_rate_requires_collaboration_mode(admin_client):
    g = make_gallery(admin_client, "Show", mode="presentation")
    img = add_image(g["id"])
    r = _pub().post(f"/api/public/g/{g['share_token']}/images/{img}/rate", json={"rating": 3})
    assert r.status_code == 400


def test_admin_image_update_sets_rating(admin_client):
    g = make_gallery(admin_client, "Collab", mode="collaboration")
    img = add_image(g["id"])
    r = admin_client.patch(f"/api/images/{img}", json={"rating": 5})
    assert r.status_code == 200 and r.json()["rating"] == 5


def test_per_reviewer_star_vote_independent_of_flag(admin_client):
    g = make_gallery(admin_client, "Team", mode="collaboration", enable_team_voting=True)
    img = add_image(g["id"])
    base = f"/api/public/g/{g['share_token']}/images/{img}/vote"
    # A flag vote, then a star vote by the same reviewer: each leaves the other column intact.
    assert _pub().put(base, json={"reviewer_name": "Anna", "color_flag": "green"}).status_code == 200
    r = _pub().put(base, json={"reviewer_name": "Anna", "rating": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["rating"] == 3 and body["color_flag"] == "green"
