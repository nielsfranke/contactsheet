# Notifications

Status: **implemented** — 2026-06-14 (60 s flush + global recipient / per-gallery master switch)

Notify the photographer when something happens in a gallery — a client comments, saves a
collection, flags/likes/votes a photo, or opens the share link. Channels are pluggable (e-mail,
Pushover, Discord, Telegram, ntfy, …) via **Apprise**; delivery is **outbox + periodic flush** so
bursts (views, flags) coalesce into one message per gallery instead of spamming. Each gallery has
a master on/off toggle.

## Decisions (locked with the user)

- **Channels = Apprise.** One dependency (`apprise`) covers 100+ services through a single
  notification URL per channel (`mailto://…`, `pover://user@token`, `discord://…`, `tgram://…`,
  `ntfy://…`). We do **not** hand-build SMTP/Pushover — the photographer pastes an Apprise URL.
  *(Later superseded for common services by **per-service presets** — pick a service, fill labelled
  fields, the Apprise URL is assembled server-side; the raw URL stays as the "custom" fallback. See
  [`notification-channel-presets.md`](notification-channel-presets.md).)*
- **Events (all four):** `comment`, `collection` (selection saved), `flag` (color-flag / like /
  vote — one bucket), `view` (share link opened). `collection` and `view` are **not logged today**
  and get new emit points; `comment`/`flag` already flow through known service code.
- **Delivery = immediate-but-coalesced, one mechanism.** Every notifiable event is written to a
  `notification_outbox` row. A single in-process async **flusher** (started in the app lifespan)
  wakes on a short interval (default 60 s), groups unsent rows per gallery, and sends **one
  message per gallery per channel**: rare events listed individually ("New comment from Anna on
  IMG_2231"), noisy events summarised as counts ("12 photos flagged", "Gallery opened 5×"). A
  60 s flush is effectively immediate for a photographer while absorbing bursts. **No cron, no
  Celery** — the loop lives in the existing FastAPI lifespan, mirroring the startup DB-cleanup task.
- **Recipient = global.** Channels belong to the instance (the photographer's own e-mail/Pushover),
  not per-gallery. Per-gallery granularity is a single **master switch** (`notifications_enabled`),
  matching the user's "pro Galerie aktivieren/deaktivieren". Event-type selection is **global**
  (which event kinds you care about, instance-wide).

## Data model

### `app_settings.notifications` (JSON, nullable) — migration `0025`

Single global config blob, validated by `schemas.notifications.NotificationSettings`
(`extra="forbid"`, object-replaces / explicit-`null`-resets, same pattern as `footer` / presets):

```jsonc
{
  "enabled": true,                          // global master kill-switch
  "events": { "comment": true, "collection": true, "flag": true, "view": false },
  "flush_seconds": 60,                      // optional override of the flush interval
  "channels": [
    { "id": "<uuid>", "name": "My email", "url": "mailto://…", "enabled": true },
    { "id": "<uuid>", "name": "Phone",   "url": "pover://user@token", "enabled": true }
  ]
}
```

- `url` is an **Apprise URL** and carries credentials (SMTP password, Pushover token). It is
  admin-only data. **Masking:** `GET /api/admin/settings` returns each channel `url` masked
  (e.g. `pover://••••@••••`) plus a boolean `has_url`; the frontend only sends a `url` back when
  the admin actually re-enters one (empty/unchanged → keep stored). This avoids leaking secrets
  into client state while still allowing edits. (Trade-off noted under Security.)

### `gallery.notifications_enabled` (bool, default `true`) — migration `0025`

Per-gallery master switch. New galleries default on; cascades like other look/behaviour flags via
the existing `apply_to_subgalleries` path is **not** applied (notifications are an
identity/operational concern, not "look & behaviour" — kept out of `_INHERIT_CREATE_FIELDS` and
the cascade list). Rides `GalleryUpdate` and the admin gallery response; **not** added to
`GalleryPublicResponse` (clients never see it).

### `notification_outbox` table — migration `0025`

| column | type | notes |
|---|---|---|
| `id` | `String(36)` PK | uuid |
| `gallery_id` | FK galleries, `ON DELETE CASCADE` | |
| `event_type` | `String(20)` | `comment` / `collection` / `flag` / `view` |
| `author` | `String(255)` nullable | reviewer name (null for anonymous views) |
| `meta` | `Text` nullable | JSON (e.g. `{ "image_id", "preview", "flag" }`) |
| `created_at` | `DateTime(tz)` | |
| `sent_at` | `DateTime(tz)` nullable | null = pending; set when flushed |

Index `(sent_at, gallery_id, created_at)` for the flusher's "pending, grouped by gallery" scan.
Model in `app/models/notification.py`. Hard-delete on flush isn't required — rows are marked
`sent_at` and pruned by the existing startup cleanup (drop sent rows older than `zip_ttl_hours`).

## Backend

### Emit — one helper, called at each event site

`notification_service.enqueue(db, gallery_id, event_type, author=None, meta=None)`:
- Early-returns if global `notifications.enabled` is false, the event type is globally off, or the
  gallery's `notifications_enabled` is false (one cheap settings read + gallery flag — both already
  loaded at most call sites). Keeps the hot path nearly free when notifications are unused.
- Otherwise inserts a `notification_outbox` row. **Never raises** into the request (wrapped in
  `try/except`, same defensive posture as the existing `activity_repo.log` call sites).

Call sites (placed next to the existing `activity_repo.log`, or new where noted):
- `comment_service.add_comment` → `enqueue(..., "comment", author, {image_id, preview})`.
- `image_service.set_flag` / `set_like` and the public `vote` route → `enqueue(..., "flag", …)`.
- `collection_service.create_collection` → **new** `activity_repo.log(..., "collection", …)`
  (also a nice activity-feed bonus) **+** `enqueue(..., "collection", creator, {name})`.
- `public.get_public_gallery` (share-link GET) → **enqueue only** `view` (no Activity row — a row
  per page-load would flood the feed). Skipped when the request carries an admin token (admin
  preview shouldn't notify) — `get_optional_admin` style guard.

### Flush — in-process async loop

`notification_service.run_flusher()` started in `app/main.py::_lifespan` via
`asyncio.create_task`, cancelled on shutdown (mirrors how StaticFiles/cleanup are wired):

```
every flush_seconds:
  pending = outbox rows where sent_at IS NULL          # one query, ordered by gallery
  for gallery_id, rows in group_by(gallery):
    msg = build_summary(rows)        # rare events itemised, flag/view counted
    for channel in enabled channels whose events include any present type:
      apprise.notify(channel.url, title, msg)          # in run_in_executor (blocks on network)
    mark those rows sent_at = now()                     # only after a successful send attempt
```

- DB work is sync SQLite (fast, tiny) executed inside the loop; **Apprise sends run in a thread
  executor** so network latency never blocks the event loop.
- A send failure for one channel leaves rows pending → retried next tick (at-least-once; acceptable
  for notifications). To avoid infinite retry on a permanently broken URL, rows older than N ticks
  are marked sent with a logged warning (give-up after ~10 min).
- Title/body are **English** (backend stays English per the i18n contract) — short, e.g.
  title `"{instance_name} — {gallery_name}"`, body the summary lines.

### Apprise wrapper

`app/notifications/apprise_client.py` — thin module: `send(url, title, body) -> bool`. Isolates the
dependency so the rest of the code doesn't import `apprise` directly (and so it can be stubbed in a
future test). `apprise` added to `backend/requirements.txt`.

### Endpoints

- Config rides the existing `GET` / `PATCH /api/admin/settings` (`AppSettingsUpdate.notifications`,
  object-replace; masked on read). No new settings endpoint.
- **`POST /api/admin/notifications/test`** (admin) — body `{ url }` (or `{ channel_id }`): sends a
  one-off "Test from ContactSheet" through Apprise and returns success/error, so the photographer
  can validate a URL before saving. The one genuinely new route.
- Per-gallery toggle rides `PATCH /api/galleries/{id}` (`GalleryUpdate.notifications_enabled`).

## Frontend

- **New settings page** `/admin/settings/notifications` (under the **Workspace** section nav in
  `SETTINGS_NAV`, alongside `workspace`/`general` — it's an admin/operational pref, not public
  branding): global enable switch, per-event-type toggles, a channels list (name + Apprise URL +
  enable, add/remove, **Test** button hitting `/notifications/test`), and a short help line linking
  Apprise URL docs with copy-paste examples (mailto / Pushover / Discord / ntfy).
- **Per-gallery switch** in `GallerySettingsModal` → **General** tab: a `notifications_enabled`
  Switch ("Notify me about this gallery"). Lives outside the preset payload (operational, not
  look/behaviour — same render-prop pattern as `client_upload`/`sets` so it never reaches the
  `extra="forbid"` preset).
- `api.admin.testNotification(...)`; `notifications` field threaded through the typed settings
  client and `lib/types.ts`.
- **i18n** — new `settings.notifications.*` keys in `messages/{en,de}.json`; run
  `node scripts/validate-i18n.mjs`. (User-facing strings are admin-surface, so both locales.)

## Security & trade-offs

- **Credentials in the DB** — Apprise URLs embed secrets, stored plaintext in `app_settings`
  (same as `admin_password_hash`'s table; consistent with the single-tenant, self-hosted model).
  Mitigation: admin-only, masked on read. Not encrypted at rest — documented limitation.
- **SSRF via channel URL** — a custom `json://`/webhook channel (or the synchronous
  `POST /notifications/test` oracle) can make the server connect to an arbitrary host, including
  internal ones. The only actor who can set channels is the authenticated instance admin (same
  trust level as someone with shell on the box), so this is low-severity by design. Hardened
  2026-06-17 (`app/notifications/url_guard.py`, see below):
  - **Rate limit** — `POST /notifications/test` is `5/minute` per IP, blunting its use as a blind
    internal port/host-discovery oracle.
  - **Send timeout** — `apprise_client.send` enforces a hard wall-clock cap
    (`NOTIFICATION_TIMEOUT`, default 10 s) so a hung internal target can't pin the test request or
    a flusher worker.
  - **Opt-in internal-target guard** — `BLOCK_INTERNAL_NOTIFICATION_TARGETS` (**default OFF**)
    refuses host-controlled schemes (`json`/`xml`/`form`/`mailto`/`ntfy`) that resolve to
    loopback/link-local/private/reserved addresses. Default-off **on purpose**: self-hosters
    routinely point ntfy/SMTP at a LAN host, and that must keep working out of the box. SaaS
    presets (pushover/telegram/slack/discord) hit fixed public endpoints and are never gated.
- **Data exfiltration via channel payload** — *accepted, documented, not solved.* An admin can set
  a channel to `json://attacker.example` and have notification payloads (comment text, reviewer
  names, etc.) delivered to a server they control. The opt-in guard above does **not** stop this:
  it only blocks *internal* hosts, and a public attacker host is a legitimate-looking target.
  We deliberately don't try to prevent it, because the only actor who can configure a channel is
  already an authenticated admin who can directly **view comments, view uploads, export galleries,
  and download originals** in-app. The marginal data-access increase from also routing payloads
  outbound is small, and any "block external egress" control would break the feature's core
  purpose (delivering notifications to third-party services). Self-hosters who need egress control
  should enforce it at the network layer (firewall / egress proxy), not in the app.
- **View notifications can still be chatty** across many galleries — mitigated by the per-gallery
  coalescing and the global `view` event defaulting **off**. The admin opts in.
- **At-least-once delivery** — a crash between send and `sent_at` write can re-send on restart.
  Acceptable for notifications; no exactly-once machinery.

## Out of scope (follow-ups)

- Per-gallery recipient overrides / per-channel event filtering.
- Quiet hours / scheduled digest windows (the flusher interval is the only knob).
- Client-facing notifications (e.g. notifying a client the gallery is ready) — this doc is
  photographer-facing only.
- Encryption-at-rest for channel credentials.
