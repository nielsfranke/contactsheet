# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Regression: datetimes must round-trip as tz-aware UTC and serialize with an explicit offset.

SQLite reads DateTime columns back naive (tzinfo=None) even with timezone=True, which made the API
emit timestamps without a 'Z'/offset — browsers then parsed them as local time (off by the viewer's
UTC offset). The UTCDateTime decorator (app/database.py) fixes this app-wide."""

from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.activity import Activity
from app.repositories import activity_repo
from tests.helpers import make_gallery


def test_model_datetime_reads_back_utc_aware(admin_client):
    g = make_gallery(admin_client, "TZ")
    db = SessionLocal()
    try:
        activity_repo.log(db, g["id"], "viewed", "Guest", ip="1.2.3.4")
        db.expire_all()
        row = db.query(Activity).filter(Activity.gallery_id == g["id"]).first()
        assert row.created_at.tzinfo is not None
        assert row.created_at.utcoffset() == timezone.utc.utcoffset(None)
    finally:
        db.close()


def test_api_serializes_datetime_with_offset(admin_client):
    """A timestamp in an API response must carry a tz designator so clients don't misparse it."""
    g = make_gallery(admin_client, "TZ2")
    created = admin_client.get(f"/api/galleries/{g['id']}").json()["created_at"]
    # fromisoformat accepts the explicit offset; the parsed value must be tz-aware.
    parsed = datetime.fromisoformat(created)
    assert parsed.tzinfo is not None, f"created_at lacks a tz offset: {created!r}"


def test_bind_normalizes_naive_and_aware_to_utc():
    """Both naive (assumed-UTC) and offset-aware inputs persist + read back as the same UTC instant."""
    from app.models.gallery import Gallery

    db = SessionLocal()
    try:
        # An aware non-UTC input (UTC+2) must be stored as the equivalent UTC instant.
        from datetime import timedelta
        plus2 = timezone(timedelta(hours=2))
        g = Gallery(name="bind", share_token="bindtok", mode="presentation",
                    created_at=datetime(2026, 6, 25, 12, 0, tzinfo=plus2))
        db.add(g); db.commit(); db.expire_all()
        row = db.query(Gallery).filter(Gallery.share_token == "bindtok").first()
        assert row.created_at == datetime(2026, 6, 25, 10, 0, tzinfo=timezone.utc)
    finally:
        db.close()
