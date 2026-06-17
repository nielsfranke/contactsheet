# Notification channel presets

Status: **implemented** — 2026-06-14

Builds on [`notifications.md`](notifications.md). Today a notification channel is a single opaque
**Apprise URL** the photographer must hand-craft (`pover://token@user`, `mailtos://user:pass@host`,
`tgram://bot/chat`, …) with only a link to the Apprise wiki for help. This adds **per-service
presets**: pick a service, fill labelled fields, and the app assembles the Apprise URL for you.
"Custom (raw Apprise URL)" stays as the escape hatch.

## Decisions (locked with the user)

- **Approach B — structured config in the backend.** A channel carries a `type` discriminator plus
  a `params` map; the Apprise URL is built **server-side** at send/test time. Channels stay
  **re-editable** (params persist; only secrets are masked, per field), validation is per service,
  and there's exactly one place that knows each service's URL syntax. (Approach A — frontend builds
  the URL into the existing opaque `url` field — was rejected: masked-on-read means a saved channel
  can't repopulate its form, so every edit is a full re-entry.)
- **Services shipped as presets:** Email (SMTP), Pushover, ntfy, Discord, Telegram, Slack. Plus
  **Custom** (raw Apprise URL) always available as the fallback for the other 90+ Apprise targets.
- **Apprise stays the single transport.** Presets only *assemble* an Apprise URL from friendly
  fields — we do not hand-roll SMTP/HTTP. The URL builder is the only new knowledge.
- **No DB migration.** `app_settings.notifications` is already a JSON blob; the channel shape just
  grows `type` + `params`. Existing channels (no `type`) default to `custom` and keep working.

## Data model

### `schemas.notifications.NotificationChannel` (extended)

```python
ChannelType = Literal["custom", "email", "pushover", "ntfy", "discord", "telegram", "slack"]

class NotificationChannel(BaseModel):
    model_config = {"extra": "forbid"}
    id: str            # unchanged
    name: str          # unchanged (friendly label)
    enabled: bool      # unchanged
    type: ChannelType = "custom"          # NEW — defaults to custom for legacy rows
    url: str = ""                          # used only when type == "custom"
    params: dict[str, str] = {}            # per-service fields when type != "custom"
```

Legacy rows (no `type`, real `url`) validate as `type="custom"` — no migration, no data touch.

### Field registry — single source of truth (`app/notifications/presets.py`)

One declarative table per service: which fields exist, which are **secret**, which are **required**,
and a `build_url(params) -> str`. The registry drives validation, masking, and URL assembly so the
three never drift.

| type | fields (✱ = required, 🔒 = secret) | Apprise URL built |
|---|---|---|
| `email` | host✱, port, user, password🔒, from, to✱ | `mailtos://user:password@host:port/?from=…&to=…` |
| `pushover` | user_key✱🔒, app_token✱🔒 | `pover://app_token@user_key` |
| `ntfy` | topic✱, server, token🔒 (or user/password🔒) | `ntfy://[token@]server/topic` (`ntfys://` default) |
| `discord` | webhook_id✱🔒, webhook_token✱🔒 | `discord://webhook_id/webhook_token` |
| `telegram` | bot_token✱🔒, chat_id✱ | `tgram://bot_token/chat_id` |
| `slack` | token_a✱🔒, token_b✱🔒, token_c✱🔒 | `slack://token_a/token_b/token_c` |
| `custom` | (raw `url` field, unchanged) | the URL verbatim |

(Exact Apprise query-arg spelling for `email`/`ntfy` is finalised against the Apprise docs during
implementation; the builder is unit-trivial and isolated in `presets.py`.)

## Backend changes

- **`app/notifications/presets.py`** (new) — the registry above: `FIELDS: dict[type, list[Field]]`
  (`Field = {key, secret, required}`) and `build_url(type, params, url) -> str`.
- **`schemas/notifications.py`**
  - `NotificationChannel` gains `type` + `params` (above). A model validator checks, per `type`:
    required fields present, unknown `params` keys rejected (mirrors `extra="forbid"`).
  - **`mask_settings`** — instead of masking the one `url`, mask each **secret** `params` value
    (`••••••••`) and emit a parallel `secrets_set: {field: bool}` so the UI knows what's stored
    behind the mask. `custom` keeps today's `url` masking + `has_url`.
  - **`merge_incoming`** — match channels by `id`; for each **secret** field, when the incoming
    value is blank or the mask sentinel, keep the stored value (so editing the `name` or a
    non-secret field never wipes credentials). Generalises today's single-URL preservation.
- **`services/notification_service.py`**
  - Flusher: build the URL via `presets.build_url(...)` instead of reading `ch["url"]`; the "enabled
    and has a destination" filter becomes "enabled and `build_url` is non-empty".
  - `send_test(...)` takes a built URL (unchanged signature; caller builds it).
- **`routers/admin_settings.py`** — `_NotificationTest` accepts either `{channel_id}` (stored,
  built from saved params) **or** `{type, params, url}` (an unsaved channel being composed); the
  endpoint builds the Apprise URL via the registry, then `send_test`. PATCH path is unchanged
  (still `merge_incoming` over stored).

## Frontend changes

- **`lib/types.ts`** — `NotificationChannel` gains `type`, `params`, `secrets_set`.
- **`lib/notification-presets.ts`** (new) — a thin mirror of the backend registry for **rendering
  only** (field keys, labels-via-i18n, `secret`/`required` flags, input type). The backend remains
  the source of truth for building/validating; the frontend never assembles URLs.
- **`settings/notifications/page.tsx`** — "Add channel" becomes a **service picker** (Email /
  Pushover / ntfy / Discord / Telegram / Slack / Custom). The chosen `type` renders its field set;
  secret fields show a `••••` placeholder when `secrets_set[field]` is true and the input is empty
  ("leave blank to keep"). The "Test" button sends `{channel_id}` for saved channels or
  `{type, params}` for unsaved ones. Custom renders the existing single URL input.
- **i18n** — new keys under `settings.notifications.*`: service names, per-field labels/placeholders,
  "leave blank to keep" hint. Added to **both** `en.json` and `de.json`; `node scripts/validate-i18n.mjs`
  must pass.

## Backwards compatibility

- Stored channels without `type` → `custom` with their existing `url`; render + send unchanged.
- The PATCH/merge/mask contract is a superset of today's; the public response gains
  `type`/`params`/`secrets_set` (additive). No migration (`0026` stays the latest).

## Out of scope / follow-ups

- Per-channel event overrides (events stay global).
- Per-gallery channel selection (gallery keeps its single master switch).
- Field-level "test before save" validation beyond the existing one-shot Test button.
- Importing an existing raw Apprise URL back into a structured preset (one-way: presets → URL only).

## Verification plan

- Backend: build each service's URL from sample params; confirm the flusher/test use `build_url`;
  confirm masking hides secrets and `merge_incoming` preserves them on a name-only edit.
- Frontend: live-drive `/admin/settings/notifications` — add a Pushover + an Email channel via the
  pickers, Test each, reload and confirm fields repopulate with masked secrets, edit a non-secret
  field and save without losing credentials. `tsc` / `lint` / `validate-i18n` / `build` green.
```
