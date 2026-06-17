# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Collections: admin CRUD + public creator-or-admin authorization."""

from fastapi.testclient import TestClient

from app.main import app

from .helpers import make_gallery, add_image


def test_admin_create_and_list_collection(admin_client):
    g = make_gallery(admin_client, "G")
    i1, i2 = add_image(g["id"], sort_order=0), add_image(g["id"], sort_order=1)
    r = admin_client.post(
        f"/api/galleries/{g['id']}/collections", json={"name": "Best", "image_ids": [i1, i2]}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Best" and body["image_ids"] == [i1, i2] and body["created_by"] is None
    assert len(admin_client.get(f"/api/galleries/{g['id']}/collections").json()) == 1


def test_collection_filters_foreign_images(admin_client):
    g = make_gallery(admin_client, "G")
    other = make_gallery(admin_client, "Other")
    i1 = add_image(g["id"])
    foreign = add_image(other["id"])
    r = admin_client.post(
        f"/api/galleries/{g['id']}/collections", json={"name": "C", "image_ids": [i1, foreign]}
    )
    assert r.json()["image_ids"] == [i1]  # foreign id dropped


def test_collection_requires_at_least_one_valid_image(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/collections", json={"name": "C", "image_ids": ["ghost"]}
    )
    assert r.status_code == 400


def test_public_collections_gated_by_toggle(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    add_image(g["id"])
    pub = TestClient(app)
    # sets_enabled defaults off → 403.
    assert pub.get(f"/api/public/g/{g['share_token']}/collections").status_code == 403
    admin_client.patch(f"/api/galleries/{g['id']}", json={"sets_enabled": True})
    assert pub.get(f"/api/public/g/{g['share_token']}/collections").status_code == 200


def test_public_create_and_creator_only_delete(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"sets_enabled": True})
    img = add_image(g["id"])
    pub = TestClient(app)

    created = pub.post(
        f"/api/public/g/{g['share_token']}/collections",
        json={"name": "Mine", "image_ids": [img], "creator": "Alice"},
    )
    assert created.status_code == 201 and created.json()["created_by"] == "Alice"
    cid = created.json()["id"]

    # A different reviewer cannot delete it.
    assert pub.delete(
        f"/api/public/g/{g['share_token']}/collections/{cid}", params={"reviewer": "Mallory"}
    ).status_code == 403
    # The creator can.
    assert pub.delete(
        f"/api/public/g/{g['share_token']}/collections/{cid}", params={"reviewer": "Alice"}
    ).status_code == 204


def test_public_cannot_delete_admin_collection(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"sets_enabled": True})
    img = add_image(g["id"])
    admin_col = admin_client.post(
        f"/api/galleries/{g['id']}/collections", json={"name": "AdminSet", "image_ids": [img]}
    ).json()
    pub = TestClient(app)
    # Admin collection has created_by=None; no public reviewer name can match it.
    assert pub.delete(
        f"/api/public/g/{g['share_token']}/collections/{admin_col['id']}", params={"reviewer": "Alice"}
    ).status_code == 403


def test_admin_can_delete_any_collection(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"sets_enabled": True})
    img = add_image(g["id"])
    pub = TestClient(app)
    cid = pub.post(
        f"/api/public/g/{g['share_token']}/collections",
        json={"name": "Mine", "image_ids": [img], "creator": "Alice"},
    ).json()["id"]
    assert admin_client.delete(f"/api/galleries/{g['id']}/collections/{cid}").status_code == 204
