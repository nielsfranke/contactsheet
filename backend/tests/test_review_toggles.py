# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Per-gallery review-feature toggles are enforced server-side, not just hidden in the UI.

Regression suite: flags/ratings, likes, and comments each have a per-gallery switch; a client with
the share link must not be able to write (or read back comments) through the API when the
photographer switched the feature off.
"""

from .helpers import make_gallery, add_image


def _review_gallery(admin_client, **toggles):
    g = make_gallery(admin_client, "Review", mode="collaboration")
    if toggles:
        r = admin_client.patch(f"/api/galleries/{g['id']}", json=toggles)
        assert r.status_code == 200, r.text
    return g


def test_flag_blocked_when_flags_disabled(admin_client):
    g = _review_gallery(admin_client, color_flags_enabled=False)
    img = add_image(g["id"])
    r = admin_client.post(f"/api/public/g/{g['share_token']}/images/{img}/flag", json={"flag": "green"})
    assert r.status_code == 403
    assert r.json()["code"] == "flags_disabled"


def test_rate_blocked_when_flags_disabled(admin_client):
    # color_flags_enabled is the generic "ratings enabled" gate in every rating mode.
    g = _review_gallery(admin_client, color_flags_enabled=False)
    img = add_image(g["id"])
    r = admin_client.post(f"/api/public/g/{g['share_token']}/images/{img}/rate", json={"rating": 3})
    assert r.status_code == 403


def test_flag_allowed_when_enabled(admin_client):
    g = _review_gallery(admin_client)  # color_flags_enabled defaults to True
    img = add_image(g["id"])
    r = admin_client.post(f"/api/public/g/{g['share_token']}/images/{img}/flag", json={"flag": "green"})
    assert r.status_code == 200 and r.json()["color_flag"] == "green"


def test_like_blocked_when_likes_disabled(admin_client):
    g = _review_gallery(admin_client)  # likes_enabled defaults to False
    img = add_image(g["id"])
    r = admin_client.post(f"/api/public/g/{g['share_token']}/images/{img}/like", json={"reviewer": "Anna"})
    assert r.status_code == 403
    assert r.json()["code"] == "likes_disabled"


def test_like_allowed_when_enabled(admin_client):
    g = _review_gallery(admin_client, likes_enabled=True)
    img = add_image(g["id"])
    r = admin_client.post(f"/api/public/g/{g['share_token']}/images/{img}/like", json={"reviewer": "Anna"})
    assert r.status_code == 200 and r.json()["likes"] == 1


def test_comments_blocked_when_disabled(admin_client):
    g = _review_gallery(admin_client, comments_enabled=False)
    img = add_image(g["id"])
    t = g["share_token"]
    post = admin_client.post(
        f"/api/public/g/{t}/images/{img}/comments", json={"author_name": "Anna", "text": "hi"}
    )
    assert post.status_code == 403
    assert post.json()["code"] == "comments_disabled"
    # Reading stored feedback is gated the same way.
    assert admin_client.get(f"/api/public/g/{t}/images/{img}/comments").status_code == 403


def test_comments_roundtrip_when_enabled(admin_client):
    g = _review_gallery(admin_client)  # comments_enabled defaults to True
    img = add_image(g["id"])
    t = g["share_token"]
    post = admin_client.post(
        f"/api/public/g/{t}/images/{img}/comments", json={"author_name": "Anna", "text": "hi"}
    )
    assert post.status_code == 201
    listed = admin_client.get(f"/api/public/g/{t}/images/{img}/comments")
    assert listed.status_code == 200 and len(listed.json()) == 1
