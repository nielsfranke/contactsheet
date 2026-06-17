# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Admin ZIP export jobs (build runs synchronously under TestClient's background tasks)."""

from .helpers import make_gallery, png_bytes


def _upload(admin_client, gallery_id):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", ("p.png", png_bytes(), "image/png"))],
    )


def test_zip_job_completes_and_downloads(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])

    job = admin_client.post(f"/api/galleries/{g['id']}/export/zip", json={"filter_type": "all"})
    assert job.status_code == 202
    job_id = job.json()["id"]

    status = admin_client.get(f"/api/galleries/{g['id']}/export/zip/{job_id}").json()
    assert status["status"] == "ready"
    assert status["image_count"] == 1

    dl = admin_client.get(f"/api/galleries/{g['id']}/export/zip/{job_id}/download")
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "application/zip"
    assert dl.content[:2] == b"PK"  # ZIP magic


def test_zip_job_missing_gallery_404(admin_client):
    assert admin_client.post("/api/galleries/ghost/export/zip", json={"filter_type": "all"}).status_code == 404


def test_filtered_zip_rejects_empty_selection(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])
    # image_ids that don't belong to the gallery → 400.
    r = admin_client.post(
        f"/api/galleries/{g['id']}/export/zip", json={"image_ids": ["not-a-real-id"]}
    )
    assert r.status_code == 400


def test_public_zip_blocked_when_downloads_disabled(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"downloads_enabled": False})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r = pub.post(f"/api/public/g/{g['share_token']}/zip", json={})
    assert r.status_code == 403
