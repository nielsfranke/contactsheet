<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Capture One export plugin

**Status:** the **server-side API-token mechanism is implemented** (branch
`feature/api-tokens`, 2026-06-27, migration `0041`). The **plugin itself**
(separate repo) is **proposed / not started**.

**Decisions locked:** macOS-first (Windows later); generic multi-client tokens
(Capture One now, Lightroom/scripts later, not C1-specific); three coarse scopes
(`galleries:read` / `galleries:write` / `images:write`), not admin-equivalent.

> This note covers two pieces of work that live in **two different repos**:
> 1. a small **server-side change in this repo** (an API-token / app-password
>    mechanism, AGPL), and
> 2. the **plugin itself in a new, separate repo** under a permissive licence.
> See [Repo & licence](#repo--licence) for why they are split.

## Goal

Let a photographer export selected photos **straight from Capture One into a
ContactSheet gallery** — pick (or create) a gallery, hit export, and Capture One
renders the RAWs per the user's export recipe and uploads them to the instance.
No manual "export to folder → drag into the web uploader" round-trip.

This is a natural fit because the division of labour is clean: **Capture One does
the rendering** (RAW → JPEG/TIFF, resize, sharpening, watermark — all from the
user's existing export recipe), and the plugin only has to **upload the finished
files** to ContactSheet's existing REST API.

## How Capture One publish plugins work

Capture One (since v12) supports two plugin kinds: **publish** (send images to an
online destination) and **edit/open-with**. We want a **publish plugin**, the
same category as the SmugMug/JPEGmini plugins.

Lifecycle:

1. The user selects photos and chooses **"ContactSheet"** as the publish target.
2. Capture One renders each image to a temp file using the chosen export recipe.
3. Capture One hands the **rendered files + metadata** to the plugin.
4. The plugin uploads them to ContactSheet:
   `POST /api/galleries/{id}/images` (multipart) — the exact path exercised by the
   E2E suite and the live-flow test.
5. The plugin's settings UI lets the user pick an existing gallery or create one.

Practical SDK constraints (confirmed from the Capture One developer docs):

- **Native languages only:** macOS = Objective-C/Swift, Windows = C#. Full
  cross-platform coverage means **two codebases**. We go **macOS-first** (the bulk
  of Capture One users) and treat Windows as a later port.
- Distributed as a `.coplugin` bundle; macOS requires **Apple notarisation**
  (Apple Developer Program, code-signing).
- The SDK is **gated behind a developer signup + EULA** and is **proprietary**
  (not open source). We link against it; we do not redistribute it.
  **Open item:** the exact EULA wording (redistribution, branding, OSS terms) is
  only visible after signup and must be read before committing.

## Server-side prerequisite: API tokens (this repo, AGPL)

Today ContactSheet only has **admin login (username/password → JWT in an httponly
cookie)** plus per-gallery share tokens. A desktop plugin must **not** embed the
admin password or drive a cookie login. We add a **personal access token (PAT)**
mechanism — the one piece of real backend work.

### Why not reuse an existing auth path

- **Gallery share token + public client-upload** (`client_upload_enabled`) was
  considered and rejected: client uploads are per-gallery, moderation-gated,
  marked `uploaded_by=client`, capped at 50/request, and can't create galleries or
  browse the library. Semantically wrong — the photographer is the *owner*, not a
  guest.
- **Admin JWT cookie** is short-lived, browser-shaped, and bumped by "sign out
  everywhere" — wrong for an unattended desktop client.

### Design

A new `api_tokens` table (migration `0041`), one row per issued token:

| Column | Notes |
|---|---|
| `id` | UUIDv4 PK |
| `name` | user-supplied label ("Capture One — MacBook") |
| `token_hash` | **SHA-256** of the secret — tokens are 256-bit random, so a fast hash + unique-index lookup is correct here (bcrypt is for low-entropy passwords) |
| `prefix` | first 12 chars (`cs_pat_` + 5), shown in the UI to identify a token without revealing it |
| `created_at` / `last_used_at` | audit (`last_used_at` touched on each successful auth) |
| `expires_at` | nullable (optional expiry) |
| `scopes` | JSON; coarse vocabulary `galleries:read` / `galleries:write` / `images:write` — enough for the plugin, nothing destructive or administrative |

**Revocation is a hard delete** of the row (no `revoked_at` — simpler, and the
secret is gone for good).

- **Issue:** `POST /api/admin/api-tokens` mints `cs_pat_<token_urlsafe>`,
  returns the secret **once** (GitHub-PAT style), stores only the hash.
- **List / revoke:** `GET` / `DELETE …/api-tokens/{id}` (never returns secrets).
- **Auth:** a `require_scope(scope)` dependency (in `auth/dependencies.py`) admits
  either the admin (cookie or admin JWT — full access) **or** a `Bearer cs_pat_…`
  whose `scopes` include `scope`. Applied to exactly four endpoints
  (`GET`/`POST /api/galleries`, `GET /api/galleries/{id}`,
  `POST /api/galleries/{id}/images`). Every other admin endpoint keeps
  `get_current_admin`, where a PAT fails to decode → 401 — so a token physically
  cannot reach settings, reset, backup, auth or token management. Coexists with the
  cookie path; the JWT `token_version` / "sign out everywhere" mechanism is
  untouched (PATs are deleted to revoke).
- **Factory reset** already hard-deletes all tables except `app_settings`, so it
  wipes tokens for free — no special-casing.
- **UI:** an "API tokens" section under admin settings (create with a copy-once
  secret reveal; list with prefix + last-used; revoke).
- Subject to the existing slowapi rate limiting; **HTTPS required** (token rides in
  a header).

### Plugin ↔ server auth flow

1. Photographer creates a PAT in ContactSheet admin and copies it.
2. In the plugin settings: paste **instance URL + token**; the plugin stores the
   token in the **OS keychain** (macOS Keychain / Windows Credential Manager),
   never plaintext on disk.
3. Plugin calls `GET /api/galleries` (Bearer) to populate the gallery picker,
   `POST /api/galleries` to create, `POST /api/galleries/{id}/images` to upload.

**No new upload/gallery endpoints are needed** — only the token auth in front of
the existing ones.

## Repo & licence

The **plugin lives in its own repo** (e.g. `contactsheet-captureone`, Forgejo
primary + GitHub push-mirror, matching the main project), licensed **MIT or
Apache-2.0** — *not* AGPL. Reasons:

1. **Licence:** a Capture One plugin is loaded into Capture One's process and
   **links the proprietary SDK framework**. AGPL/GPL + proprietary linking is the
   classic incompatibility; permissive licensing (or a GPL linking exception) is
   how OSS photo plugins handle this. ContactSheet's AGPL does **not** force the
   plugin's licence — the plugin is an **independent HTTP client** that contains no
   ContactSheet source, and **AGPL §13 (network use) applies to the server, not a
   client**.
2. **Toolchain / distribution:** Swift/Xcode + C#, `.coplugin` packaging, Apple
   notarisation — a different ecosystem, CI, and release cadence (tracks the
   **Capture One SDK**, not ContactSheet releases).
3. The `ml/` sidecar lives *in* the main repo, but that precedent doesn't transfer:
   it is **same-licence** (AGPL, own code) and **same deploy** (docker-compose).
   The plugin is neither.

The **server-side API-token work stays in this repo (AGPL)** — that's the only
coupling point.

## Rollout phases

1. **Server (this repo, AGPL):** ✅ **done** (branch `feature/api-tokens`) —
   `api_tokens` model + migration `0041` + issue/list/revoke endpoints +
   `require_scope` Bearer auth dependency + 11 tests. **Still to do:** the admin
   **frontend UI** ("API tokens" settings page — create with copy-once reveal,
   list, revoke).
2. **New plugin repo (MIT/Apache):** macOS Swift publish-plugin MVP — settings
   (URL + keychain token), gallery picker (existing/create), upload with progress
   + error handling (401 / 413 / moderation).
3. **Distribution:** notarisation, `.coplugin` packaging, install docs.
4. **Later:** Windows C# port; fine-grained token scopes; optional read-back of
   flags/comments.

## Decisions made

- **Platform:** macOS-first; Windows is a later port.
- **Token scopes:** three coarse scopes (read/write galleries, write images), not
  admin-equivalent. Fine-grained scopes can be added later without a schema change.
- **Token hashing:** SHA-256 (high-entropy tokens; bcrypt rejected).
- **Generic, not C1-specific:** the token mechanism is a plain PAT any client can
  use (Lightroom, scripts, CI), not branded to Capture One.

## Open questions (still to confirm)

- **SDK EULA** wording (redistribution, branding, whether a Capture One review/
  listing is required to distribute, OSS compatibility) — read at signup.
- **Gallery UX:** create-on-export, pick-existing, or both; target sub-gallery?
- **Apple Developer Program** ($99/yr) for notarisation — required for macOS
  distribution.
