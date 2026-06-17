# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Gallery CRUD, nesting, moves, share tokens, and the empty-cascade regression."""

from app.database import SessionLocal
from app.repositories import gallery_repo

from .helpers import make_gallery, add_image


def test_create_and_get_gallery(admin_client):
    g = make_gallery(admin_client, "Wedding")
    assert g["name"] == "Wedding"
    assert g["share_token"]
    assert g["has_password"] is False
    got = admin_client.get(f"/api/galleries/{g['id']}")
    assert got.status_code == 200 and got.json()["id"] == g["id"]


def test_create_requires_name(admin_client):
    assert admin_client.post("/api/galleries", json={"name": ""}).status_code == 422


def test_nested_gallery_tree(admin_client):
    parent = make_gallery(admin_client, "Parent")
    child = make_gallery(admin_client, "Child", parent_id=parent["id"])
    tree = admin_client.get("/api/galleries").json()
    parent_node = next(g for g in tree if g["id"] == parent["id"])
    assert [c["id"] for c in parent_node["children"]] == [child["id"]]


def test_create_under_missing_parent_404(admin_client):
    assert admin_client.post("/api/galleries", json={"name": "x", "parent_id": "does-not-exist"}).status_code == 404


def test_update_gallery_fields(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.patch(f"/api/galleries/{g['id']}", json={"name": "Renamed", "downloads_enabled": False})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed" and body["downloads_enabled"] is False


def test_set_and_clear_password(admin_client):
    g = make_gallery(admin_client, "Secret")
    assert admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "hunter2"}).json()["has_password"] is True
    # Empty string clears the password.
    assert admin_client.patch(f"/api/galleries/{g['id']}", json={"password": ""}).json()["has_password"] is False


def test_apply_to_subgalleries_cascade(admin_client):
    parent = make_gallery(admin_client, "P")
    child = make_gallery(admin_client, "C", parent_id=parent["id"])
    admin_client.patch(
        f"/api/galleries/{parent['id']}",
        json={"preview_size": "large", "apply_to_subgalleries": True},
    )
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["preview_size"] == "large"


def test_name_does_not_cascade(admin_client):
    parent = make_gallery(admin_client, "P")
    child = make_gallery(admin_client, "C", parent_id=parent["id"])
    admin_client.patch(
        f"/api/galleries/{parent['id']}", json={"name": "NewName", "apply_to_subgalleries": True}
    )
    # Identity (name) is never cascaded.
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["name"] == "C"


# --- moves / reparenting ---------------------------------------------------------------------

def test_move_to_top_level_and_under_parent(admin_client):
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B")
    # Nest B under A.
    r = admin_client.post(f"/api/galleries/{b['id']}/move", json={"target_parent_id": a["id"]})
    assert r.status_code == 200 and r.json()["parent_id"] == a["id"]
    # Move B back to top level.
    r = admin_client.post(f"/api/galleries/{b['id']}/move", json={"target_parent_id": None})
    assert r.json()["parent_id"] is None


def test_move_into_self_rejected(admin_client):
    a = make_gallery(admin_client, "A")
    assert admin_client.post(f"/api/galleries/{a['id']}/move", json={"target_parent_id": a["id"]}).status_code == 400


def test_move_into_descendant_rejected(admin_client):
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B", parent_id=a["id"])
    c = make_gallery(admin_client, "C", parent_id=b["id"])
    # Moving A under its grandchild C would create a cycle.
    assert admin_client.post(f"/api/galleries/{a['id']}/move", json={"target_parent_id": c["id"]}).status_code == 400


def test_move_assigns_append_sort_order(admin_client):
    parent = make_gallery(admin_client, "P")
    make_gallery(admin_client, "C1", parent_id=parent["id"])
    make_gallery(admin_client, "C2", parent_id=parent["id"])
    mover = make_gallery(admin_client, "M")
    r = admin_client.post(f"/api/galleries/{mover['id']}/move", json={"target_parent_id": parent["id"]})
    assert r.json()["sort_order"] == 2  # appended after the two existing children


# --- share tokens ----------------------------------------------------------------------------

def test_share_token_named_slug(admin_client):
    g = make_gallery(admin_client, "My Cool Gallery!")
    r = admin_client.post(f"/api/galleries/{g['id']}/share-token", json={"strategy": "named"})
    assert r.json()["share_token"] == "my-cool-gallery"


def test_share_token_custom_validation(admin_client):
    g = make_gallery(admin_client, "G")
    assert admin_client.post(
        f"/api/galleries/{g['id']}/share-token", json={"strategy": "custom", "value": "Bad Slug!"}
    ).status_code == 400
    ok = admin_client.post(
        f"/api/galleries/{g['id']}/share-token", json={"strategy": "custom", "value": "good-slug"}
    )
    assert ok.status_code == 200 and ok.json()["share_token"] == "good-slug"


def test_share_token_custom_collision(admin_client):
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B")
    admin_client.post(f"/api/galleries/{a['id']}/share-token", json={"strategy": "custom", "value": "taken"})
    assert admin_client.post(
        f"/api/galleries/{b['id']}/share-token", json={"strategy": "custom", "value": "taken"}
    ).status_code == 409


# --- delete / empty --------------------------------------------------------------------------

def test_soft_delete_cascades_subtree(admin_client):
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B", parent_id=a["id"])
    c = make_gallery(admin_client, "C", parent_id=b["id"])
    assert admin_client.delete(f"/api/galleries/{a['id']}").status_code == 204
    # Whole subtree gone from the active tree.
    for gid in (a["id"], b["id"], c["id"]):
        assert admin_client.get(f"/api/galleries/{gid}").status_code == 404


def test_empty_gallery_cascades_to_grandchildren(admin_client):
    """Regression: empty() must soft-delete the entire descendant subtree, not just one level."""
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B", parent_id=a["id"])
    c = make_gallery(admin_client, "C", parent_id=b["id"])  # grandchild of A
    img_a = add_image(a["id"])
    img_c = add_image(c["id"])

    assert admin_client.delete(f"/api/galleries/{a['id']}/contents").status_code == 204

    db = SessionLocal()
    try:
        # A itself stays live; every descendant gallery + their images are gone.
        assert gallery_repo.get_by_id(db, a["id"]) is not None
        assert gallery_repo.get_by_id(db, b["id"]) is None
        assert gallery_repo.get_by_id(db, c["id"]) is None
        from app.repositories import image_repo
        assert image_repo.get_by_id(db, img_a) is None
        assert image_repo.get_by_id(db, img_c) is None
    finally:
        db.close()
