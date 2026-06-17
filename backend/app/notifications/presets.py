# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Notification channel presets — the single source of truth for service field shapes.

Each preset declares its fields (which are secret, which are required) and how to assemble an
Apprise URL from them. Schema validation, credential masking and URL building all read this
registry, so they can never drift. ``custom`` keeps the raw-URL escape hatch (no fields).
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote, urlencode

CHANNEL_TYPES = ("custom", "email", "pushover", "ntfy", "discord", "telegram", "slack")


@dataclass(frozen=True)
class Field:
    key: str
    secret: bool = False
    required: bool = False


# Field shape per service. Order matters — the UI renders fields in this order.
FIELDS: dict[str, list[Field]] = {
    "email": [
        Field("host", required=True),
        Field("port"),
        Field("user"),
        Field("password", secret=True),
        Field("from"),
        Field("to", required=True),
    ],
    "pushover": [
        Field("user_key", secret=True, required=True),
        Field("app_token", secret=True, required=True),
    ],
    "ntfy": [
        Field("topic", required=True),
        Field("server"),
        Field("token", secret=True),
    ],
    "discord": [
        Field("webhook_id", secret=True, required=True),
        Field("webhook_token", secret=True, required=True),
    ],
    "telegram": [
        Field("bot_token", secret=True, required=True),
        Field("chat_id", required=True),
    ],
    "slack": [
        Field("token_a", secret=True, required=True),
        Field("token_b", secret=True, required=True),
        Field("token_c", secret=True, required=True),
    ],
}


def allowed_keys(channel_type: str) -> set[str]:
    return {f.key for f in FIELDS.get(channel_type, [])}


def secret_keys(channel_type: str) -> set[str]:
    return {f.key for f in FIELDS.get(channel_type, []) if f.secret}


def _q(v: str) -> str:
    return quote(v, safe="")


def build_url(channel_type: str, params: dict | None, url: str = "") -> str:
    """Assemble the Apprise URL for a channel. Returns "" when the config is incomplete
    (a required field is missing) so callers treat the channel as having no destination."""
    if channel_type == "custom":
        return (url or "").strip()

    fields = FIELDS.get(channel_type)
    if not fields:
        return ""
    p = {f.key: ((params or {}).get(f.key) or "").strip() for f in fields}
    if any(f.required and not p[f.key] for f in fields):
        return ""

    if channel_type == "pushover":
        return f"pover://{_q(p['user_key'])}@{_q(p['app_token'])}"
    if channel_type == "discord":
        return f"discord://{_q(p['webhook_id'])}/{_q(p['webhook_token'])}"
    if channel_type == "telegram":
        return f"tgram://{_q(p['bot_token'])}/{_q(p['chat_id'])}"
    if channel_type == "slack":
        return f"slack://{_q(p['token_a'])}/{_q(p['token_b'])}/{_q(p['token_c'])}"
    if channel_type == "ntfy":
        host = (p.get("server") or "ntfy.sh").split("://", 1)[-1].strip("/")
        base = f"ntfys://{host}/{_q(p['topic'])}"
        if p.get("token"):
            base += "?" + urlencode({"token": p["token"]})
        return base
    if channel_type == "email":
        auth = ""
        if p.get("user"):
            auth = _q(p["user"]) + (f":{_q(p['password'])}" if p.get("password") else "") + "@"
        host = p["host"] + (f":{p['port']}" if p.get("port") else "")
        qs = {k: p[k] for k in ("from", "to") if p.get(k)}
        query = ("?" + urlencode(qs)) if qs else ""
        return f"mailtos://{auth}{host}/{query}"
    return ""
