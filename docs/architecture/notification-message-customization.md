# Notification message customization + gallery link

Status: proposed — 2026-06-25

Two additions to the notifications system ([[notifications]],
[[notification-channel-presets]]):

1. **Custom message text** — per-event line templates + a title template, so the
   photographer can reword (or translate) the coalesced summary.
2. **Gallery link** — optionally append the public gallery URL to each
   notification so a tap opens the gallery.

Both live **inside the existing `app_settings.notifications` JSON blob** — no new
column, **no Alembic migration**. They are new fields on the `NotificationSettings`
Pydantic model, which already validates that blob.

## Recap: how messages are built today

`notification_service._build_summary(instance_name, gallery_name, rows)` groups
the gallery's pending outbox rows by `event_type` and emits **one summary** per
gallery per flush:

- **title** = `"{instance_name} — {gallery_name}"`
- **body** = one line per event group. `comment` / `annotation` / `collection`
  emit one line *per row* (with `author` + a preview/name); `upload` /
  `download` / `flag` / `view` emit a single *aggregated* line with a count.

The flusher (`_flush_once`) already loads the `Gallery` row per group, so
`gallery.share_token` is in hand at send time.

## Feature 1 — message text templates

### Schema (`schemas/notifications.py`)

New model + two fields on `NotificationSettings`:

```python
class NotificationTemplates(BaseModel):
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
    ...
    include_link: bool = True                      # feature 2
    templates: NotificationTemplates = Field(default_factory=NotificationTemplates)
```

**Empty string = use the built-in default.** This is the key compatibility
property: existing installs (no `templates` key) and any field left blank render
**byte-identical** to today. `mask_settings` / `merge_incoming` need no changes —
templates carry no secrets and pass through (`out = dict(stored)` /
`result = dict(incoming)` only rewrite `channels`).

### Rendering (`notification_service._build_summary`)

`_build_summary` gains a `templates: dict | None` arg. For each event group:

- **override present** → `template.format_map(_Safe(ctx))`, where `_Safe` is a
  `dict` subclass whose `__missing__` returns `""` (unknown placeholder → empty,
  never `KeyError`). Wrapped in try/except → on any error fall back to the
  default line, so a malformed template can never break delivery.
- **override blank** → the existing hardcoded f-string (unchanged).

Lines that render empty are dropped before joining.

**Placeholder contract** (documented in the UI):

| Event | Placeholders |
|---|---|
| `title` | `{instance}`, `{gallery}` |
| `comment`, `annotation` | `{author}`, `{preview}`, `{gallery}`, `{instance}` |
| `collection` | `{author}`, `{name}`, `{gallery}`, `{instance}` |
| `upload` | `{count}` (photos), `{gallery}`, `{instance}` |
| `download` | `{count}` (downloads), `{photos}` (photo count), `{gallery}`, `{instance}` |
| `flag` | `{count}`, `{gallery}`, `{instance}` |
| `view` | `{count}`, `{gallery}`, `{instance}` |

Note: built-in defaults keep the smart "quote/pluralize only when present"
behaviour. Custom templates get the **raw** values (`{preview}` is the bare text,
`{count}` the bare number) — the author controls wording/punctuation. This avoids
re-implementing English pluralization inside template land.

## Feature 2 — gallery link

New `include_link: bool = True`. In `_flush_once`, after building the summary:

```python
base = (app.public_base_url or "").rstrip("/")
if cfg.get("include_link", True) and base and gallery:
    body = f"{body}\n\n🔗 {base}/g/{gallery.share_token}".lstrip("\n")
```

- Only appended when **Public Base URL is set** — without it the link would be
  relative (`/g/…`) and unclickable in an email/push client, so we skip it
  rather than emit a broken link.
- Default **on** (per product decision). Existing installs that have a Public
  Base URL configured will start including links after upgrade — called out in
  the release/deploy note.
- Bare absolute URL on its own line — Apprise targets (email, Telegram, ntfy,
  Discord, …) auto-linkify it. The link is appended *after* template rendering,
  so it is independent of the text templates (no `{link}` placeholder in v1).

## Frontend (`admin/settings/notifications/page.tsx`)

- Extend `DEFAULTS` and the `value` merge with `include_link` (default `true`)
  and `templates` (default all-blank), so legacy blobs render sane controls.
- New **"Message"** section:
  - **Include gallery link** toggle (`apply`, saves immediately) with a hint
    that it needs Public Base URL set.
  - **Message text** sub-block: a title input + one input per event, each
    `onBlur={commit}` (free-text → save on blur, matching the channel fields).
    `placeholder` shows the English default; a hint lists the placeholders for
    that field. Templates are an *advanced* affordance — blank = default.
- Types (`lib/types.ts`): add `include_link: boolean` and a
  `NotificationTemplates` interface to `NotificationSettings`.

## i18n

New keys under `settings.notifications` in `en.json` (source of truth) + `de.json`
(parity enforced by `validate-i18n.mjs`): section titles/hints, the include-link
toggle, per-field labels, and the placeholder hint strings.

## Tests

`backend/tests/` (notifications): assert (a) blank templates reproduce the
default summary, (b) a custom `comment` / `upload` template renders with
substituted placeholders, (c) `{link}`/footer appended only when `include_link`
and `public_base_url` are both set, (d) a malformed template falls back to the
default line.

## Out of scope (v1)

- Per-gallery template overrides (templates stay instance-wide, like channels).
- A `{link}` placeholder inside body templates (link is a managed footer).
- Per-channel template variants (same body to every channel, as today).
