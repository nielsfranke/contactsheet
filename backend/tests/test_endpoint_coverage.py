# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Happy-path coverage for endpoints the feature suites don't touch — small, one behaviour each,
so a regression on a rarely-exercised route (bulk moderation, admin comments, the icon routes…)
still shows up in CI."""

import io

from fastapi.testclient import TestClient

from app.main import app

from .conftest import ADMIN_PASSWORD, ADMIN_USERNAME
from .helpers import add_image, make_gallery, png_bytes


def _pub():
    return TestClient(app)


# --- auth -------------------------------------------------------------------------------------

def test_change_username_requires_the_current_password_and_takes_effect(admin_client):
    r = admin_client.post("/api/auth/change-username", json={"new_username": "studio", "current_password": "nope"})
    assert r.status_code == 400
    r = admin_client.post("/api/auth/change-username", json={"new_username": "studio", "current_password": ADMIN_PASSWORD})
    assert r.status_code == 200
    assert admin_client.get("/api/auth/me").json()["username"] == "studio"
    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": False}).status_code == 401
    assert fresh.post("/api/auth/login", json={"username": "studio", "password": ADMIN_PASSWORD, "remember": False}).status_code == 200


def test_logout_clears_this_browser_only(admin_client):
    other = TestClient(app)
    other.post("/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": False})
    r = admin_client.post("/api/auth/logout")
    assert r.status_code == 200
    # The cookie is deleted on this jar; the other browser's session is untouched (unlike logout-all).
    assert "access_token=;" in r.headers.get("set-cookie", "") or 'access_token=""' in r.headers.get("set-cookie", "")
    assert admin_client.get("/api/auth/me").status_code == 401
    assert other.get("/api/auth/me").status_code == 200


# --- images / moderation ----------------------------------------------------------------------

def test_bulk_approve_publishes_pending_client_uploads(admin_client):
    g = make_gallery(admin_client, "Mod", mode="collaboration")
    a = add_image(g["id"], filename="a.jpg", moderation_status="pending")
    b = add_image(g["id"], filename="b.jpg", moderation_status="pending")
    assert _pub().get(f"/api/public/g/{g['share_token']}/images").json() == []
    r = admin_client.post(f"/api/galleries/{g['id']}/images/approve", json={"image_ids": [a, b]})
    assert r.status_code == 200 and r.json()["approved"] == 2
    assert {i["id"] for i in _pub().get(f"/api/public/g/{g['share_token']}/images").json()} == {a, b}


def test_watermark_file_upload_and_delete(admin_client):
    g = make_gallery(admin_client, "WM")
    r = admin_client.post(f"/api/galleries/{g['id']}/watermark", files=[("file", ("wm.png", png_bytes(), "image/png"))])
    assert r.status_code == 200 and r.json()["filename"].endswith(".png")
    first = r.json()["filename"]
    r = admin_client.post(f"/api/galleries/{g['id']}/watermark", files=[("file", ("wm2.png", png_bytes(), "image/png"))])
    assert r.status_code == 200 and r.json()["filename"] != first
    import json as _json
    import os
    from app.config import settings as cfg
    assert not os.path.exists(os.path.join(cfg.watermarks_dir, g["id"], first))  # previous file removed
    assert admin_client.delete(f"/api/galleries/{g['id']}/watermark").status_code == 204
    ws = _json.loads(admin_client.get(f"/api/galleries/{g['id']}").json()["watermark_settings"])
    assert ws.get("filename") is None


# --- gallery admin extras ---------------------------------------------------------------------

def test_activity_feed_lists_client_events(admin_client):
    g = make_gallery(admin_client, "Act", mode="collaboration")
    img = add_image(g["id"])
    assert _pub().post(f"/api/public/g/{g['share_token']}/images/{img}/flag", json={"flag": "green"}).status_code == 200
    r = admin_client.get(f"/api/galleries/{g['id']}/activity")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1 and body["items"][0]["gallery_id"] == g["id"]


def test_export_flagged_filenames_as_text(admin_client):
    g = make_gallery(admin_client, "Exp", mode="collaboration")
    keep = add_image(g["id"], filename="keep.jpg")
    add_image(g["id"], filename="skip.jpg")
    _pub().post(f"/api/public/g/{g['share_token']}/images/{keep}/flag", json={"flag": "green"})
    r = admin_client.get(f"/api/galleries/{g['id']}/export?flag=green")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "keep.jpg" in r.text and "skip.jpg" not in r.text
    assert r.headers["content-disposition"].startswith("attachment")


def test_admin_comment_crud(admin_client):
    g = make_gallery(admin_client, "C", mode="collaboration")
    img = add_image(g["id"])
    base = f"/api/galleries/{g['id']}/images/{img}/comments"
    r = admin_client.post(base, json={"author_name": "Photographer", "text": "Look at the crop"})
    assert r.status_code == 201
    cid = r.json()["id"]
    assert [c["id"] for c in admin_client.get(base).json()] == [cid]
    r = admin_client.patch(f"{base}/{cid}", json={"text": "Crop tighter"})
    assert r.status_code == 200 and r.json()["text"] == "Crop tighter"
    assert admin_client.delete(f"{base}/{cid}").status_code == 204
    assert admin_client.get(base).json() == []


# --- public extras ----------------------------------------------------------------------------

def test_public_votes_for_reviewer(admin_client):
    g = make_gallery(admin_client, "Team", mode="collaboration", enable_team_voting=True)
    img = add_image(g["id"])
    _pub().put(f"/api/public/g/{g['share_token']}/images/{img}/vote", json={"reviewer_name": "Anna", "color_flag": "green"})
    r = _pub().get(f"/api/public/g/{g['share_token']}/votes?reviewer=Anna")
    assert r.status_code == 200 and [v["image_id"] for v in r.json()] == [img]
    assert _pub().get(f"/api/public/g/{g['share_token']}/votes?reviewer=Ben").json() == []


def test_public_comment_delete_is_author_only(admin_client):
    g = make_gallery(admin_client, "C", mode="collaboration")
    img = add_image(g["id"])
    base = f"/api/public/g/{g['share_token']}/images/{img}/comments"
    cid = _pub().post(base, json={"author_name": "Anna", "text": "nice"}).json()["id"]
    assert _pub().delete(f"{base}/{cid}?reviewer=Ben").status_code in (403, 404)
    assert _pub().delete(f"{base}/{cid}?reviewer=Anna").status_code == 204
    assert _pub().get(base).json() == []


def test_public_zip_job_status_and_download(admin_client):
    g = make_gallery(admin_client, "Zip")
    admin_client.post(f"/api/galleries/{g['id']}/images", files=[("files", ("a.png", png_bytes(), "image/png"))])
    job = _pub().post(f"/api/public/g/{g['share_token']}/zip", json={}).json()
    status = _pub().get(f"/api/public/g/{g['share_token']}/zip/{job['id']}").json()
    assert status["status"] == "ready" and status["download_url"]
    r = _pub().get(status["download_url"])
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"


def test_admin_zip_job_delete(admin_client):
    g = make_gallery(admin_client, "Zip")
    admin_client.post(f"/api/galleries/{g['id']}/images", files=[("files", ("a.png", png_bytes(), "image/png"))])
    job = admin_client.post(f"/api/galleries/{g['id']}/export/zip", json={"filter_type": "all"}).json()
    assert admin_client.delete(f"/api/galleries/{g['id']}/export/zip/{job['id']}").status_code == 204
    assert admin_client.get(f"/api/galleries/{g['id']}/export/zip/{job['id']}").status_code == 404


# --- admin settings extras --------------------------------------------------------------------

def test_semantic_search_status_and_reindex_without_sidecar(admin_client):
    r = admin_client.get("/api/admin/settings/semantic-search/status")
    assert r.status_code == 200 and "configured" in r.json()
    r = admin_client.post("/api/admin/settings/semantic-search/reindex")
    assert r.status_code in (200, 400, 409)  # no sidecar in tests: a clean refusal, never a 500


def test_logo_delete(admin_client):
    r = admin_client.post("/api/admin/settings/logo", files=[("file", ("logo.png", png_bytes(), "image/png"))])
    assert r.status_code == 200 and r.json()["logo_url"]
    assert admin_client.delete("/api/admin/settings/logo").status_code == 204
    assert admin_client.get("/api/admin/settings").json()["logo_url"] is None


def test_backup_list_and_delete(admin_client):
    job = admin_client.post("/api/admin/settings/backup", json={"scope": "metadata", "include_renditions": False}).json()
    listed = admin_client.get("/api/admin/settings/backup").json()
    assert [j["id"] for j in listed] == [job["id"]]
    assert admin_client.delete(f"/api/admin/settings/backup/{job['id']}").status_code == 204
    assert admin_client.get("/api/admin/settings/backup").json() == []


# --- PWA icons --------------------------------------------------------------------------------

def test_branding_icons_render_and_etag(admin_client):
    pub = _pub()
    for path, ctype in (
        ("/api/branding/favicon.ico", "image/"),
        ("/api/branding/icon-192.png", "image/png"),
        ("/api/branding/icon-512.png", "image/png"),
        ("/api/branding/icon-maskable.png", "image/png"),
        ("/api/branding/apple-touch-icon.png", "image/png"),
    ):
        r = pub.get(path)
        assert r.status_code == 200 and r.headers["content-type"].startswith(ctype), path
        assert r.headers.get("etag")
        assert pub.get(path, headers={"If-None-Match": r.headers["etag"]}).status_code == 304
    m = pub.get("/api/branding/manifest.webmanifest")
    assert m.status_code == 200 and "icons" in m.json()
