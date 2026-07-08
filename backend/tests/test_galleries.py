# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Gallery CRUD, nesting, moves, share tokens, and the empty-cascade regression."""

from app.database import SessionLocal
from app.repositories import gallery_repo

from .helpers import make_gallery, add_image


def test_create_and_get_gallery(admin_client):
    g = make_gallery(admin_client, "Portraits")
    assert g["name"] == "Portraits"
    assert g["share_token"]
    assert g["has_password"] is False
    got = admin_client.get(f"/api/galleries/{g['id']}")
    assert got.status_code == 200 and got.json()["id"] == g["id"]


def test_create_requires_name(admin_client):
    assert admin_client.post("/api/galleries", json={"name": ""}).status_code == 422


def test_share_token_is_12_url_safe_chars(admin_client):
    """New galleries get a 12-char lowercase-alphanumeric token (~62 bits of entropy)."""
    token = make_gallery(admin_client, "Entropy")["share_token"]
    assert len(token) == 12
    assert all(c in "abcdefghijklmnopqrstuvwxyz0123456789" for c in token)


def test_legacy_8_char_token_still_resolves(admin_client):
    """Existing 8-char tokens (issued before the length bump) must keep working after an update —
    the lookup matches the token string verbatim, with no length check."""
    g = make_gallery(admin_client, "Legacy")
    db = SessionLocal()
    try:
        gallery = gallery_repo.get_by_id(db, g["id"])
        gallery.share_token = "abcd1234"  # 8 chars, the old format
        db.commit()
    finally:
        db.close()
    assert admin_client.get("/api/public/g/abcd1234").status_code == 200


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


def test_apply_to_subgalleries_cascades_full_subtree(admin_client):
    """The cascade reaches every descendant, not just direct children — galleries nest
    to any depth, so a grandchild must pick up the setting too."""
    parent = make_gallery(admin_client, "P")
    child = make_gallery(admin_client, "C", parent_id=parent["id"])
    grandchild = make_gallery(admin_client, "GC", parent_id=child["id"])
    admin_client.patch(
        f"/api/galleries/{parent['id']}",
        json={"preview_size": "large", "apply_to_subgalleries": True},
    )
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["preview_size"] == "large"
    assert admin_client.get(f"/api/galleries/{grandchild['id']}").json()["preview_size"] == "large"


def test_name_does_not_cascade(admin_client):
    parent = make_gallery(admin_client, "P")
    child = make_gallery(admin_client, "C", parent_id=parent["id"])
    admin_client.patch(
        f"/api/galleries/{parent['id']}", json={"name": "NewName", "apply_to_subgalleries": True}
    )
    # Identity (name) is never cascaded.
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["name"] == "C"


def test_mode_does_not_cascade(admin_client):
    """apply_to_subgalleries carries look & behaviour but never a child's mode — a container holds
    mixed Review + Showcase sub-galleries. See docs/proposals/gallery-per-container-mode-presets.md."""
    parent = make_gallery(admin_client, "P", mode="presentation")
    child = make_gallery(admin_client, "C", parent_id=parent["id"], mode="presentation")
    admin_client.patch(
        f"/api/galleries/{parent['id']}",
        json={"mode": "collaboration", "preview_size": "large", "apply_to_subgalleries": True},
    )
    child_after = admin_client.get(f"/api/galleries/{child['id']}").json()
    assert child_after["mode"] == "presentation"   # mode left alone
    assert child_after["preview_size"] == "large"  # look & behaviour still cascaded


def test_subgallery_same_mode_inherits_parent(admin_client):
    """A sub-gallery created in the SAME mode as its parent still copies the parent's live look."""
    parent = make_gallery(admin_client, "P", mode="presentation")
    admin_client.patch(f"/api/galleries/{parent['id']}", json={"preview_size": "small"})
    child = make_gallery(admin_client, "C", parent_id=parent["id"], mode="presentation")
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["preview_size"] == "small"


def test_subgallery_divergent_mode_uses_instance_preset(admin_client):
    """A sub-gallery created with a DIFFERENT mode than its parent ignores the parent's (wrong-mode)
    look and pulls the instance standard preset for the chosen mode — like a top-level gallery."""
    # Instance Review preset says preview_size=large.
    admin_client.patch("/api/admin/settings", json={"preset_collaboration": {"preview_size": "large"}})
    # A Showcase parent customized to small.
    parent = make_gallery(admin_client, "P", mode="presentation")
    admin_client.patch(f"/api/galleries/{parent['id']}", json={"preview_size": "small"})
    # A Review sub-gallery under it → diverges → takes the Review preset (large), not parent (small).
    child = make_gallery(admin_client, "C", parent_id=parent["id"], mode="collaboration")
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["preview_size"] == "large"


# --- per-container sub-gallery presets (Part 2) ----------------------------------------------

def test_subgallery_presets_roundtrip_and_validation(admin_client):
    g = make_gallery(admin_client, "P")
    r = admin_client.patch(
        f"/api/galleries/{g['id']}",
        json={"subgallery_presets": {"collaboration": {"preview_size": "small"}}},
    )
    assert r.status_code == 200
    assert r.json()["subgallery_presets"] == {"collaboration": {"preview_size": "small"}}
    # Unknown mode key → 422.
    assert admin_client.patch(
        f"/api/galleries/{g['id']}", json={"subgallery_presets": {"bogus": {"preview_size": "small"}}}
    ).status_code == 422
    # Unknown preset field → 422 (GalleryPreset forbids extras).
    assert admin_client.patch(
        f"/api/galleries/{g['id']}", json={"subgallery_presets": {"presentation": {"nope": 1}}}
    ).status_code == 422
    # Explicit null clears.
    r = admin_client.patch(f"/api/galleries/{g['id']}", json={"subgallery_presets": None})
    assert r.json()["subgallery_presets"] is None


def test_container_preset_beats_instance_preset_for_divergent_child(admin_client):
    """A container's own per-mode sub-gallery preset layers over the instance preset for a
    divergent-mode child."""
    admin_client.patch("/api/admin/settings", json={"preset_collaboration": {"preview_size": "large"}})
    parent = make_gallery(admin_client, "P", mode="presentation")
    admin_client.patch(
        f"/api/galleries/{parent['id']}",
        json={"subgallery_presets": {"collaboration": {"preview_size": "small"}}},
    )
    # Review child diverges → folder preset (small) wins over the instance preset (large).
    child = make_gallery(admin_client, "C", parent_id=parent["id"], mode="collaboration")
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["preview_size"] == "small"


def test_subgallery_presets_inherited_to_depth(admin_client):
    """The container's presets are carried down the tree, so a divergent-mode gallery created
    several levels deep still finds its folder preset via an immediate-parent lookup."""
    top = make_gallery(admin_client, "Top", mode="presentation")
    admin_client.patch(
        f"/api/galleries/{top['id']}",
        json={"subgallery_presets": {"collaboration": {"preview_size": "small"}}},
    )
    # Same-mode sub-folder inherits (and carries the presets down).
    mid = make_gallery(admin_client, "Mid", parent_id=top["id"], mode="presentation")
    assert admin_client.get(f"/api/galleries/{mid['id']}").json()["subgallery_presets"] == {
        "collaboration": {"preview_size": "small"}
    }
    # A Review gallery two levels deep still picks up the inherited folder preset.
    deep = make_gallery(admin_client, "Deep", parent_id=mid["id"], mode="collaboration")
    assert admin_client.get(f"/api/galleries/{deep['id']}").json()["preview_size"] == "small"


def test_subgallery_presets_cascade(admin_client):
    parent = make_gallery(admin_client, "P")
    child = make_gallery(admin_client, "C", parent_id=parent["id"])
    admin_client.patch(
        f"/api/galleries/{parent['id']}",
        json={
            "subgallery_presets": {"presentation": {"preview_size": "large"}},
            "apply_to_subgalleries": True,
        },
    )
    assert admin_client.get(f"/api/galleries/{child['id']}").json()["subgallery_presets"] == {
        "presentation": {"preview_size": "large"}
    }


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


def test_use_video_as_header_rejected(admin_client):
    """A video has no Pillow-readable rendition; setting it as the header must 400, not write a
    broken header file (the resize step would otherwise fail on the video bytes)."""
    g = make_gallery(admin_client, "Vid")
    vid = add_image(g["id"], is_video=True, filename="clip.mp4")
    r = admin_client.post(f"/api/galleries/{g['id']}/header-image/from-image", json={"image_id": vid})
    assert r.status_code == 400, r.text
