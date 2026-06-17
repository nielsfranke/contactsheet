<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Factory reset

**Status:** implemented (2026-06-16)

## Goal

Give the admin a single, guarded action that returns the instance to a
**fresh-install state** — all galleries, media, feedback, collections and
settings gone, the admin account cleared — so the next visit lands on the
**first-run setup wizard** (`/setup`). For self-hosted users this replaces
"SSH in and delete the Docker volumes" with an in-app button.

This is the most destructive action in the app and is **irreversible**, so the
design is guardrails-first.

## Scope (chosen)

**Full factory reset** — wipes *everything* (data + files + settings + admin
credentials), not just content. After it runs the instance is indistinguishable
from a brand-new deployment that has never completed setup.

## What gets wiped

1. **All domain data** — every table **except `app_settings`**, hard-deleted
   (the soft-delete rule is for normal gallery/image lifecycle; a factory reset
   purges for real). Done **data-driven**: iterate
   `Base.metadata.sorted_tables` in **reverse** (children before parents →
   FK-safe with `PRAGMA foreign_keys=ON`) and `DELETE` from each table whose
   name isn't `app_settings`. No hand-maintained table list to drift — this
   automatically covers `galleries`, `images`, `comments`, `annotations`,
   `image_votes`, `activities`, `collections`, `collection_images`, `zip_jobs`,
   `notification_outbox`, and anything added later.
2. **Files on disk** — clear the *contents* of `upload_dir`, `exports_dir`,
   `branding_dir`, `watermarks_dir` (keep the dirs themselves so the running
   process's static mounts stay valid). Operates strictly within the four
   configured dirs (no path traversal; we never delete the dir roots).
3. **Settings + admin account** — delete the `app_settings` row and let
   `settings_repo.get` recreate a fresh default singleton (`setup_complete`
   back to its default `False`, `admin_username` / `admin_password_hash` →
   `NULL`, branding/presets/notifications/theme all back to model defaults).
   Then **regenerate the secret key** (`secrets.token_hex(32)`, persisted) and
   update `runtime_config` (`set_secret_key`, `set_token_version` to the fresh
   row's `1`). Regenerating the key + clearing the admin invalidates every
   outstanding token, so the acting admin is immediately logged out — exactly
   right: the next request hits `/setup`.

Order: data tables → files → settings (so a settings reset doesn't orphan
in-flight references). All DB work in one transaction; file wipe after commit.

## Guardrails

- **Admin-only** endpoint (`get_current_admin`), **rate-limited**
  (`@limiter.limit("3/minute")` — far stricter than other writes).
- **Password re-entry**: the request body carries `{password}`, verified against
  `admin_password_hash` → `CodedHTTPException(400, "invalid_current_password")`
  on mismatch. (Verified *before* any deletion.)
- **Typed confirmation** (client-side): the dialog requires typing `RESET` and
  the password before the destructive button enables. The literal word keeps the
  copy localizable while the gesture stays deliberate.
- The dialog spells out, in plain language, that this deletes **all galleries,
  photos and settings** and cannot be undone.

## Design

### Backend

- **`app/services/reset_service.py`** — `factory_reset(db, password)`:
  1. Load settings; `verify_password(password, admin_password_hash)` → coded 400
     on mismatch (nothing deleted yet).
  2. `for t in reversed(Base.metadata.sorted_tables): if t.name != "app_settings": db.execute(t.delete())`; commit.
  3. Wipe the four dirs' contents (`os.scandir` + `os.remove` / `shutil.rmtree`
     per entry), guarded to stay within each configured root.
  4. Delete + recreate the `app_settings` row; regenerate & persist secret key;
     `set_secret_key` / `set_token_version`.
- **Route** — `POST /api/admin/reset` in `routers/admin_settings.py`
  (`ResetRequest{password}`, `request: Request` for the limiter). Returns
  `{ok: true}`. (No response cookie work needed — the regenerated key already
  invalidates the caller's token; the client redirects to `/setup`.)

### Frontend

- **API** — `api.adminSettings.reset(password)` → `POST /api/admin/reset`.
- **UI** — a **"Danger zone"** card at the bottom of
  `/admin/settings/general` (the instance/technical page — not the personal
  Account page, so it isn't confused with credential changes). A red-outlined
  section + "Reset ContactSheet…" button opens a `ConfirmDialog`-style modal:
  warning copy, a `type RESET to confirm` input, a password field, and a
  `destructive` button disabled until both are satisfied. On success: toast,
  clear the `sessionStorage` auth flag (`lib/auth.ts`), and hard-redirect to
  `/setup` (`window.location.href` — a full reload so all React Query caches and
  the stale cookie are dropped).
- **i18n** — `settings.general.danger.*` (title, description, button, dialog
  title/body, the `RESET` confirm label + placeholder, password label, success
  toast) in en + de; reuse `errors.invalid_current_password`. Validate with
  `node scripts/validate-i18n.mjs`.

## Out of scope / non-goals

- Selective/partial reset (content-only, settings-only) — explicitly the full
  reset was chosen.
- A backup/export-before-reset step (the user owns their data dir; a separate
  feature if wanted).
- Multi-tenant concerns — single-instance, single-admin by design.

## Files touched

| File | Change |
|---|---|
| `backend/app/services/reset_service.py` | **new** — `factory_reset` |
| `backend/app/schemas/...` | `ResetRequest{password}` (in `schemas/settings.py` or `auth.py`) |
| `backend/app/routers/admin_settings.py` | `POST /api/admin/reset` |
| `frontend/src/lib/api.ts` | `api.adminSettings.reset` |
| `frontend/src/app/admin/settings/general/page.tsx` | Danger-zone section + confirm modal |
| `frontend/messages/{en,de}.json` | `settings.general.danger.*` |

No migration (no schema change). No new backend dependency.
