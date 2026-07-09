# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Impressum / privacy pages + the always-on public legal strip.

See docs/architecture/impressum-and-powered-by-strip.md."""

import os
import subprocess
from pathlib import Path

import sqlalchemy as sa

from app.models.activity import Activity
from app.models.app_settings import AppSettings
from app.models.notification import NotificationOutbox
from app.repositories import settings_repo


# --- the new-vs-existing default split (the load-bearing mechanic) ---------------------------

def test_fresh_install_gets_support_link_on(db):
    """A brand-new instance: settings_repo.get() INSERTs the singleton using the *model* default,
    so the upstream support link is on out of the box."""
    s = settings_repo.get(db)
    assert s.support_link_enabled is True


def test_existing_install_keeps_support_link_off(tmp_path):
    """An instance that already has the singleton row when the column arrives is backfilled from
    the migration's server_default ("0") — it must NOT sprout a donation link on upgrade.

    Runs the **real** migration chain against an isolated temp DB: migrate to 0046 (the pre-feature
    schema), insert the singleton as a live instance would have it, then upgrade to 0047. It's the
    migration itself that has to be right, so this drives the same `alembic upgrade` the deploy's
    `start.sh` runs, rather than re-typing its DDL.

    Driven as a subprocess because `backend/alembic/` (the migrations package) shadows the Alembic
    library on sys.path, so `from alembic import command` can't be imported here.
    """
    root = Path(__file__).resolve().parents[1]
    db_path = tmp_path / "existing.db"
    env = {
        **os.environ,
        "DB_URL": f"sqlite:///{db_path}",
        "UPLOAD_DIR": str(tmp_path / "u"),
        "EXPORTS_DIR": str(tmp_path / "e"),
        "BRANDING_DIR": str(tmp_path / "b"),
        "WATERMARKS_DIR": str(tmp_path / "w"),
    }

    def alembic(target: str) -> None:
        result = subprocess.run(
            [str(root / ".venv" / "bin" / "alembic"), "upgrade", target],
            cwd=root, env=env, capture_output=True, text=True,
        )
        assert result.returncode == 0, f"alembic upgrade {target} failed:\n{result.stderr}"

    alembic("0046")  # a pre-feature instance

    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO app_settings (id, instance_name) VALUES (1, 'Existing')"))
    engine.dispose()

    alembic("0047")  # the upgrade under test

    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        row = conn.execute(
            sa.text("SELECT support_link_enabled, instance_name FROM app_settings WHERE id = 1")
        ).one()
    engine.dispose()

    assert row[0] == 0, "an existing instance must keep the support link off after upgrade"
    assert row[1] == "Existing", "existing settings must survive the migration"


# --- the public legal endpoint --------------------------------------------------------------

def test_legal_page_404s_when_unset(client):
    assert client.get("/api/public/legal/impressum").status_code == 404
    assert client.get("/api/public/legal/privacy").status_code == 404


def test_legal_page_returns_content_when_set(client, db):
    settings_repo.update(db, impressum="Musterstudio\nMusterstr. 1\n12345 Berlin")
    r = client.get("/api/public/legal/impressum")
    assert r.status_code == 200
    body = r.json()
    assert body["doc"] == "impressum"
    assert "Musterstr. 1" in body["content"]


def test_legal_page_rejects_unknown_doc(client):
    """`doc` is a Literal, so anything else is a 422 — never a getattr into AppSettings."""
    assert client.get("/api/public/legal/admin_password_hash").status_code == 422


def test_whitespace_only_page_is_treated_as_unset(client, db):
    settings_repo.update(db, privacy="   \n  ")
    assert client.get("/api/public/legal/privacy").status_code == 404


def test_legal_page_is_side_effect_free(client, db):
    """Like /meta: a scraper or a bot hitting the imprint must not log activity or queue a
    notification."""
    settings_repo.update(db, impressum="Imprint")
    before_activity = db.query(Activity).count()
    before_outbox = db.query(NotificationOutbox).count()

    assert client.get("/api/public/legal/impressum").status_code == 200

    assert db.query(Activity).count() == before_activity
    assert db.query(NotificationOutbox).count() == before_outbox


def test_legal_content_is_not_interpreted_as_html(client, db):
    """Stored verbatim and shipped as JSON text; the client renders it as text. Nothing escapes or
    strips here, so assert the payload round-trips exactly — the *client* must not inject it."""
    payload = "<script>alert(1)</script>"
    settings_repo.update(db, impressum=payload)
    assert client.get("/api/public/legal/impressum").json()["content"] == payload


# --- the public gallery strip fields --------------------------------------------------------

def _make_gallery(admin_client):
    r = admin_client.post("/api/galleries", json={"name": "Legal strip"})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_public_gallery_exposes_source_url_even_with_footer_disabled(admin_client, client, db):
    """The AGPL §13 source offer is made to *network users* and is not gated by footer_enabled."""
    settings_repo.update(db, footer_enabled=False, source_url="https://example.test/src")
    gallery = _make_gallery(admin_client)

    body = client.get(f"/api/public/g/{gallery['share_token']}").json()
    assert body["footer"] is None, "branding footer is off"
    assert body["source_url"] == "https://example.test/src", "but the source offer still ships"


def test_public_gallery_reports_legal_page_availability(admin_client, client, db):
    settings_repo.update(db, impressum="Imprint", privacy=None)
    gallery = _make_gallery(admin_client)

    body = client.get(f"/api/public/g/{gallery['share_token']}").json()
    assert body["impressum_available"] is True
    assert body["privacy_available"] is False
    # booleans, not bodies — a long imprint must not ride every gallery payload
    assert "impressum" not in body


def test_support_link_flag_reaches_the_public_gallery(admin_client, client, db):
    settings_repo.update(db, support_link_enabled=False)
    gallery = _make_gallery(admin_client)
    assert client.get(f"/api/public/g/{gallery['share_token']}").json()["support_link_enabled"] is False


# --- pre-auth strip (/login, /setup) -----------------------------------------------------------

def test_setup_status_exposes_legal_strip_fields(client, db):
    """`/login` and `/setup` are public pages, so the strip must reach them before auth. The
    already-public setup/status payload carries the flags — never the page bodies."""
    settings_repo.update(db, impressum="Imprint", source_url="https://example.test/src")

    body = client.get("/api/setup/status").json()
    assert body["source_url"] == "https://example.test/src"
    assert body["support_link_enabled"] is True
    assert body["impressum_available"] is True
    assert body["privacy_available"] is False
    assert "impressum" not in body and "privacy" not in body


def test_setup_status_stays_unauthenticated_and_leaks_nothing(client, db):
    """It is reachable pre-setup (no admin exists yet) and must not expose secrets."""
    settings_repo.update(db, impressum="Imprint")
    r = client.get("/api/setup/status")
    assert r.status_code == 200
    for secret in ("admin_password_hash", "secret_key", "admin_username", "notifications"):
        assert secret not in r.json()


# --- admin settings round-trip ----------------------------------------------------------------

def test_admin_can_set_and_clear_legal_pages(admin_client):
    r = admin_client.patch("/api/admin/settings", json={"impressum": "Angaben gemäß §5 DDG"})
    assert r.status_code == 200
    assert r.json()["impressum"] == "Angaben gemäß §5 DDG"

    # a blank body clears the page → link hidden, route 404s again
    r = admin_client.patch("/api/admin/settings", json={"impressum": "  "})
    assert r.status_code == 200
    assert r.json()["impressum"] is None
    assert admin_client.get("/api/public/legal/impressum").status_code == 404


def test_admin_can_toggle_support_link(admin_client):
    r = admin_client.patch("/api/admin/settings", json={"support_link_enabled": False})
    assert r.status_code == 200
    assert r.json()["support_link_enabled"] is False
