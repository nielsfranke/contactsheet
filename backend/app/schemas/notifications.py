# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.notifications import presets

# Notifiable event kinds. "flag" buckets color-flag / like / vote; "view" is a share-link open;
# "upload" fires when a client upload lands in a moderated gallery's approval queue;
# "download" fires when a client requests a ZIP download.
EVENT_KEYS = ("comment", "annotation", "collection", "flag", "upload", "download", "view")

ChannelType = Literal["custom", "email", "pushover", "ntfy", "discord", "telegram", "slack"]


class NotificationEvents(BaseModel):
    """Which event kinds to notify on (instance-wide)."""

    model_config = {"extra": "forbid"}

    comment: bool = True
    annotation: bool = True
    collection: bool = True
    flag: bool = True
    upload: bool = True  # client upload awaiting review (only fires for moderated galleries)
    download: bool = True  # client requested a ZIP download
    view: bool = False  # chatty by nature — opt-in


class NotificationChannel(BaseModel):
    """A single Apprise destination.

    Either a preset (``type`` ∈ email/pushover/… + structured ``params``, from which the Apprise
    URL is built server-side, see ``presets.build_url``) or ``type="custom"`` with a raw Apprise
    ``url``. Credentials (preset secret fields, or the custom URL) are masked on read.
    """

    # `ignore` (not `forbid`): mask_settings adds display-only fields (`has_url`, `secrets_set`) on
    # read which the client echoes back on save — they must be dropped, not rejected (else the whole
    # PATCH 422s). `_normalize` + `merge_incoming` strip/handle them anyway.
    model_config = {"extra": "ignore"}

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(default="", max_length=80)
    type: ChannelType = "custom"
    url: str = Field(default="", max_length=1000)  # custom type only
    params: dict[str, str] = Field(default_factory=dict)  # preset fields
    enabled: bool = True

    @field_validator("name", "url", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _normalize(self):
        """Keep the channel canonical: custom carries only ``url`` (no params); a preset carries
        only the known ``params`` for its type (unknown keys dropped, values stripped) and no url."""
        if self.type == "custom":
            self.params = {}
        else:
            allowed = presets.allowed_keys(self.type)
            self.params = {
                k: (v or "").strip()
                for k, v in (self.params or {}).items()
                if k in allowed
            }
            self.url = ""
        return self


class NotificationTemplates(BaseModel):
    """Optional per-event line templates + a title template. A blank field falls back to the
    built-in default, so an empty/absent block renders byte-identical to the stock summary.

    Custom templates are substituted with ``str.format_map`` against the event's placeholders
    (see ``notification_service._build_summary``); unknown placeholders resolve to empty.
    """

    model_config = {"extra": "ignore"}

    title: str = Field(default="", max_length=300)
    comment: str = Field(default="", max_length=300)
    annotation: str = Field(default="", max_length=300)
    collection: str = Field(default="", max_length=300)
    upload: str = Field(default="", max_length=300)
    download: str = Field(default="", max_length=300)
    flag: str = Field(default="", max_length=300)
    view: str = Field(default="", max_length=300)


class NotificationSettings(BaseModel):
    """Global notifications config (app_settings.notifications)."""

    model_config = {"extra": "forbid"}

    enabled: bool = False
    events: NotificationEvents = Field(default_factory=NotificationEvents)
    # How often the flusher drains the outbox (seconds). Clamped to a sane range.
    flush_seconds: int = Field(default=60, ge=15, le=3600)
    channels: list[NotificationChannel] = Field(default_factory=list)
    # Append the public gallery link (/g/{share_token}) to each message. Only emitted when
    # public_base_url is set (else the link would be relative/unclickable). Default on.
    include_link: bool = True
    # Per-event message text overrides; blank fields use the built-in defaults.
    templates: NotificationTemplates = Field(default_factory=NotificationTemplates)


# ---- Masking ---------------------------------------------------------------

_MASK = "••••••••"


def _mask_url(url: str) -> str:
    """Hide credentials while keeping the scheme recognisable (``pover://••••••••``)."""
    if not url:
        return ""
    scheme, sep, _ = url.partition("://")
    return f"{scheme}{sep}{_MASK}" if sep else _MASK


def mask_settings(stored: dict | None) -> dict | None:
    """Mask credentials for the admin read response. Custom channels: mask ``url`` + expose
    ``has_url``. Preset channels: mask each secret ``param`` and expose ``secrets_set`` (which
    secrets have a stored value) so the UI can show a "leave blank to keep" placeholder."""
    if not stored:
        return stored
    out = dict(stored)
    channels = []
    for ch in stored.get("channels", []) or []:
        c = dict(ch)
        ctype = c.get("type", "custom")
        if ctype == "custom":
            c["has_url"] = bool(c.get("url"))
            c["url"] = _mask_url(c.get("url", ""))
        else:
            params = dict(c.get("params") or {})
            secret = presets.secret_keys(ctype)
            secrets_set = {}
            for k in secret:
                secrets_set[k] = bool(params.get(k))
                if params.get(k):
                    params[k] = _MASK
            c["params"] = params
            c["secrets_set"] = secrets_set
            c["url"] = ""
        channels.append(c)
    out["channels"] = channels
    return out


def merge_incoming(stored: dict | None, incoming: dict) -> dict:
    """Merge a PATCH payload over stored config, preserving stored credentials when the client
    sends back a blank/masked value (so editing other fields never wipes secrets).

    Channels are matched by ``id``. Custom: a real (non-masked, non-empty) ``url`` replaces the
    stored one, else the stored URL is kept. Presets: each secret ``param`` is kept from storage
    when the incoming value is blank/masked, else replaced.
    """
    stored = stored or {}
    stored_by_id = {c.get("id"): c for c in stored.get("channels", []) or []}
    result = dict(incoming)
    channels = []
    for ch in incoming.get("channels", []) or []:
        c = dict(ch)
        c.pop("has_url", None)
        c.pop("secrets_set", None)
        ctype = c.get("type", "custom")
        prev = stored_by_id.get(c.get("id")) or {}
        if ctype == "custom":
            url = (c.get("url") or "").strip()
            if not url or _MASK in url:
                c["url"] = prev.get("url", "")
        else:
            params = dict(c.get("params") or {})
            prev_params = prev.get("params") or {}
            for k in presets.secret_keys(ctype):
                v = (params.get(k) or "").strip()
                if not v or _MASK in v:
                    params[k] = prev_params.get(k, "")
            c["params"] = params
        channels.append(c)
    result["channels"] = channels
    return result
