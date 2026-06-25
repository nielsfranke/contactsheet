# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Notification message composition: custom text templates + the gallery-link footer.

`_build_summary` is template-aware — a blank/absent override renders byte-identical to the stock
summary, a custom override is substituted with the event's placeholders, and a malformed template
falls back to the default (delivery must never break). The flusher appends the public gallery link
only when `include_link` is on *and* a public base URL is configured.
"""

import json
from types import SimpleNamespace

from app.models.gallery import Gallery
from app.repositories import notification_repo, settings_repo
from app.services import notification_service as ns


def _row(event_type: str, author: str | None = None, meta: dict | None = None):
    return SimpleNamespace(
        event_type=event_type,
        author=author,
        meta=json.dumps(meta) if meta else None,
    )


# ---- _build_summary: defaults unchanged ------------------------------------

def test_blank_templates_match_stock_summary():
    rows = [_row("comment", "Ann", {"preview": "nice"})]
    title, body = ns._build_summary("Studio", "Wedding", rows, None)
    assert title == "Studio — Wedding"
    assert body == "💬 New comment from Ann: “nice”"


def test_whitespace_override_falls_back_to_default():
    rows = [_row("upload", None, {"count": 2})]
    _, body = ns._build_summary("S", "G", rows, {"upload": "   "})
    assert body == "📤 2 photos awaiting review"


# ---- _build_summary: custom templates --------------------------------------

def test_custom_comment_template_substitutes_placeholders():
    rows = [_row("comment", "Ann", {"preview": "nice"})]
    _, body = ns._build_summary("Studio", "Wedding", rows, {"comment": "{author} on {gallery}: {preview}"})
    assert body == "Ann on Wedding: nice"


def test_custom_title_template():
    title, _ = ns._build_summary("Studio", "Wedding", [_row("view")], {"title": "[{gallery}] @ {instance}"})
    assert title == "[Wedding] @ Studio"


def test_aggregated_count_placeholders():
    # download: {count} = number of download events, {photos} = total photos across them.
    rows = [_row("download", None, {"count": 4})]
    _, body = ns._build_summary("S", "G", rows, {"download": "{count} downloads, {photos} photos"})
    assert body == "1 downloads, 4 photos"


def test_unknown_placeholder_renders_empty():
    rows = [_row("flag"), _row("flag")]
    _, body = ns._build_summary("S", "G", rows, {"flag": "{count} flags by {nobody}"})
    assert body == "2 flags by"  # trailing whitespace stripped


def test_malformed_template_falls_back_to_default():
    rows = [_row("comment", "Ann", {"preview": "x"})]
    _, body = ns._build_summary("S", "G", rows, {"comment": "{author"})  # unbalanced brace
    assert body == "💬 New comment from Ann: “x”"


# ---- flusher: gallery-link footer ------------------------------------------

def _setup(db, *, include_link: bool, base_url: str | None):
    settings_repo.update(
        db,
        instance_name="Studio",
        public_base_url=base_url,
        notifications={
            "enabled": True,
            "include_link": include_link,
            "events": {"view": True},
            "flush_seconds": 60,
            "channels": [
                {"id": "c1", "name": "x", "type": "custom", "url": "json://localhost", "params": {}, "enabled": True}
            ],
            "templates": {},
        },
    )
    g = Gallery(name="Wedding", share_token="tok123")
    db.add(g)
    db.commit()
    notification_repo.enqueue(db, g.id, "view", None, None)
    db.commit()
    return g


def _capture(monkeypatch):
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        ns.apprise_client, "send",
        lambda url, title, body, timeout=None: sent.append((url, title, body)) or True,
    )
    return sent


def test_link_appended_when_enabled_and_base_url_set(db, monkeypatch):
    _setup(db, include_link=True, base_url="https://ex.com")
    sent = _capture(monkeypatch)
    ns._flush_once()
    assert len(sent) == 1
    assert sent[0][2].endswith("🔗 https://ex.com/g/tok123")


def test_link_omitted_when_toggle_off(db, monkeypatch):
    _setup(db, include_link=False, base_url="https://ex.com")
    sent = _capture(monkeypatch)
    ns._flush_once()
    assert len(sent) == 1
    assert "🔗" not in sent[0][2]


def test_link_omitted_without_base_url(db, monkeypatch):
    _setup(db, include_link=True, base_url=None)
    sent = _capture(monkeypatch)
    ns._flush_once()
    assert len(sent) == 1
    assert "🔗" not in sent[0][2]
