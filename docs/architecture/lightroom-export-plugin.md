<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Lightroom export plugin

**Status:** **shipped.** All server-side pieces are on `main` — the generic
personal-access-token (PAT) mechanism (migration `0041`) that the
[Capture One export plugin](./captureone-export-plugin.md) introduced non-C1-specific
so Lightroom could reuse it, the `images:write` gate on `DELETE /api/images/{id}`
(publish re-uploads / removals), and the `images:read` scope + gallery-scoped
`GET /api/galleries/{id}/images/picks` endpoint (client-picks readback). The
**plugin is built, released, and working** in Lightroom Classic — it lives in its own
MIT-licensed repo:
[contactsheet-lightroom](https://github.com/nielsfranke/contactsheet-lightroom)
(v0.8.0 release: export + Publish Service + client-picks readback, macOS + Windows).

> This note follows the same split as the C1 plugin: the **plugin lives in its own
> permissively-licensed repo** (`contactsheet-lightroom`); the only thing that lands
> in *this* (AGPL) repo is the readback endpoint (Phase 2), now shipped.

## Goal

Let a photographer publish selected photos **straight from Lightroom Classic into a
ContactSheet gallery** — pick (or create) a gallery, hit publish, and Lightroom
renders the RAWs per the user's export settings and uploads the finished files.
No "export to folder → drag into the web uploader" round-trip.

Same clean division of labour as Capture One: **Lightroom does the rendering**
(RAW → JPEG/TIFF, resize, sharpening, watermark — from the user's export settings),
the plugin only **uploads the rendered files** to ContactSheet's existing REST API.

## Why Lightroom is the *easier and richer* target than Capture One

Everything that made the C1 plugin friction-heavy disappears, and the Publish
Service model offers more than C1's publish API.

| | Capture One | **Lightroom Classic** |
|---|---|---|
| Language | Obj-C/Swift **+** C# — two codebases | **Lua, one codebase** for macOS + Windows |
| Distribution | `.coplugin`, **Apple notarisation**, Developer Program | `.lrplugin` folder, **no signing/notarisation**, zip & ship |
| SDK access | gated signup + proprietary EULA | **free, openly documented**, no gate |
| Publish model | render → hand off | **Publish Service** with change-tracking |

- **One Lua codebase, both OSes.** The C1 note's biggest open cost (two native
  codebases, macOS-first, Windows "later") is gone.
- **No Apple Developer Program, no notarisation, no proprietary EULA.** An
  `.lrplugin` is a plain folder of Lua. The three C1 "open questions" (EULA wording,
  notarisation, $99/yr) **do not exist here**.
- **Publish Service ≠ plain export.** Lightroom's `LrPublishService` provider keeps
  a persistent mapping of *published photo → remote ID/URL*, detects edits
  ("Modified Photos to Re-Publish"), and can sync deletions. We get real
  **incremental sync** instead of blind re-upload.

**Target = Lightroom Classic.** Lightroom (cloud / "CC") has **no local plugin SDK**
of this kind — only a remote REST API and a different workflow. Out of scope.

## How a Lightroom publish plugin works

A `.lrplugin` bundle whose `Info.lua` registers an **Export Service Provider** with
publishing enabled (`supportsIncrementalPublish = true`). Key pieces:

- **`Info.lua`** — manifest: SDK version, the service-provider script, plugin
  metadata fields (where we store the per-photo remote ID).
- **Service provider (Lua):**
  - `sectionsForTopOfDialog` / export settings UI via `LrView` — instance URL,
    token, gallery picker (existing / create).
  - `processRenderedPhotos(functionContext, exportContext)` — Lightroom hands us
    each **rendered** temp file; we `POST` it. Progress via `exportContext` scope.
  - Publish hooks: `getCollectionBehaviorInfo`, `imposeSortOrderOnPublishedCollection`,
    deletion via `deletePhotosFromPublishedCollection`.
- **HTTP:** `LrHttp.postMultipart` for uploads, `LrTasks` for async, `LrErrors`
  for failure surfacing.
- **Token storage:** Lightroom has no OS-keychain API; store the PAT in plugin
  prefs (`LrPrefs`). Documented caveat — same trust model as any LrPrefs-stored
  credential (Lightroom's own service plugins do this). Optionally offer the macOS
  Keychain via a small `security`-CLI shell-out; decide in Phase 1.

## Server side: nothing new for the MVP

The PAT mechanism (`require_scope` in `auth/dependencies.py`) already fronts exactly
the three endpoints the plugin needs, admitting a `Bearer cs_pat_…` whose `scopes`
include the required one:

| Plugin action | Endpoint | Scope |
|---|---|---|
| Populate gallery picker | `GET /api/galleries` | `galleries:read` (list-only) |
| Create gallery on publish | `POST /api/galleries` | `galleries:write` |
| Upload rendered photo | `POST /api/galleries/{id}/images` | `images:write` |

The photographer mints a token in ContactSheet admin
(`/admin/settings/api-tokens`), pastes **instance URL + token** into the plugin,
done. **No new upload/gallery endpoints.**

## Auth flow

1. Photographer creates a PAT in ContactSheet admin, copies the copy-once secret.
2. Plugin settings: paste instance URL + token → stored in `LrPrefs` (see caveat
   above).
3. Plugin calls `GET /api/galleries` (Bearer) for the picker, `POST /api/galleries`
   to create, `POST /api/galleries/{id}/images` to upload each rendered file.

Error mapping to surface in Lightroom: `401` (bad/expired token → re-auth prompt),
`413` (file too large), moderation/`client_upload` cases, network/`5xx` (retry).

## Publish Service (as built)

The provider is **both** an Export Service Provider and a Publish Service
(`supportsIncrementalPublish = true`) — the File > Export path is unchanged, and
ContactSheet additionally appears under *Publish Services*. The publish callbacks
live in `CSPublishSupport.lua`; the upload loop (`processRenderedPhotos`) is shared
and branches on `exportContext.publishedCollectionInfo`.

Model — **a Published Collection ↔ a ContactSheet gallery**:

- **First publish:** create a gallery named after the collection
  (`POST /api/galleries`) and record its id as the collection's remote id
  (`exportSession:recordRemoteCollectionId`). The gallery's public URL is recorded as
  the collection's remote URL (for *Show in ContactSheet*).
- **Each photo** records its ContactSheet **image id** as the published photo id
  (`rendition:recordPublishedPhotoId`, from the upload's `UploadResponse.id`).
- **Re-publish** (edited photo): delete the old server image first
  (`DELETE /api/images/{id}`), then upload the new render — no duplicate.
- **Remove from collection:** `deletePhotosFromPublishedCollection` deletes each
  image from ContactSheet.

This needs **one backend change** beyond the MVP's three endpoints: `DELETE
/api/images/{id}` was admin-cookie-only and is now gated by `require_scope(
"images:write")`, so a PAT can delete an image (admin cookie still admitted). No new
endpoint, no schema change. Gallery deletion stays admin-only, so deleting a
*published collection* in Lightroom does not delete the ContactSheet gallery.

Deferred publish polish: mapping a collection to an *existing* gallery (not only
auto-create) via a per-collection settings panel (`viewForCollectionSettings`).

## Phase 2 — read client picks back into Lightroom (the differentiator) — as built

Lightroom can write per-photo metadata, so the publish plugin pulls each photo's
ContactSheet engagement (color flag / like / star rating) and reflects it as a
**Lightroom color label or star rating**. This is the picdrop/CloudSpot "review →
back to my catalog" workflow, and it's where Lightroom's publish model beats C1's.

This needed the one remaining piece of backend work, because the ordinary read scope
is deliberately list-only:

- `galleries:read` grants only `GET /api/galleries` (the picker list).
- A single gallery's contents — `GET /api/galleries/{gallery_id}` and
  `GET /api/galleries/{gallery_id}/images` — are **`get_current_admin` only**, so a
  PAT cannot read the full gallery.

**Shipped (AGPL, this repo):** a narrow, token-readable projection of per-image
review state for one gallery — `GET /api/galleries/{id}/images/picks`
(`routers/galleries.py`) gated by a **new `images:read` scope**, returning only
`{image_id, filename, color_flag, rating, like_count}` (no comments, no PII, no full
library enumeration). It keeps the "read token = small blast radius" principle:
list-galleries and read-one-gallery's-picks are separate scopes, neither exposes the
whole library or any other gallery's contents. The scope was additive — no schema
change (scopes are JSON), existing tokens unaffected.

Mapping in the plugin: ContactSheet color flag → LR color label; star rating →
LR rating; configurable, opt-in (don't clobber the photographer's own labels
silently).

**Two client-side readback commands** (both use the same `/images/picks` endpoint;
no further backend work):

- **Sync client picks** (v0.8.0) — for **Publish Service** collections. Matches catalog
  photos to ContactSheet images by the remote id stored at publish time (exact).
- **Import client picks from a gallery…** (**v0.9.0**) — for galleries made with plain
  **Export** or on the web, which have no publish mapping in the catalog. Matches by
  **filename** (basename, case-insensitive; `IMG_1234.jpg` ↔ `IMG_1234.CR3`), applied to
  the current Library selection. Duplicate basenames — on either side — are skipped, not
  guessed. This closes the "readback only works for published galleries" gap (the
  original limitation a user hit when a gallery had been created via Export). Verified
  end-to-end in Lightroom Classic (3/60 filename-matched photos correctly labelled/rated;
  non-matching photos untouched). See `contactsheet-lightroom` `DESIGN-import-picks.md`.

## Repo & licence

The **plugin lives in its own repo** (e.g. `contactsheet-lightroom`, Forgejo
primary + GitHub push-mirror, matching the main project + the C1 plugin), licensed
**MIT/Apache-2.0** — not AGPL. Same reasoning as the C1 note: the plugin is an
independent HTTP client containing no ContactSheet source, AGPL §13 (network use)
binds the *server* not a client, and it tracks the **Lightroom SDK**'s cadence, not
ContactSheet releases. Lightroom's SDK is not linked as a proprietary binary
framework (it's a Lua host), so the licence story is even cleaner than C1's.

The **optional Phase-2 `images:read` endpoint stays in this repo (AGPL)** — the only
coupling point, and only if we do readback.

## Rollout phases — all shipped in v0.8.0

1. **Plugin MVP (MIT repo):** ✅ `.lrplugin` with settings (URL + token), gallery
   picker (existing/create), `processRenderedPhotos` upload with progress + error
   handling (401 / 413 / moderation). No backend work.
2. **Publish Service semantics:** ✅ persistent published-collection mapping
   (remote image ID in plugin metadata), re-publish on edit, deletion sync.
3. **Phase 2 readback:** ✅ `images:read` scope + `…/images/picks` endpoint;
   ContactSheet flags/ratings mapped → LR color labels / stars.
4. **Distribution:** ✅ zipped `.lrplugin` on the repo's Releases. Adobe Exchange
   listing remains an optional later step.

## Decisions (resolved)

- **Token storage:** `LrPrefs` — simple, matches other LR plugins; the macOS
  Keychain shell-out was left as a possible later option, not the MVP.
- **Phase-2 readback:** shipped, with `images:read` as its **own** scope (not a
  widened `galleries:read`) — the smaller blast radius won.
- **Gallery UX:** create-on-publish is the default; mapping a collection to an
  *existing* gallery (`viewForCollectionSettings`) stays a deferred polish item.
- **Lightroom Classic only** — confirmed. Lightroom cloud has no local plugin SDK
  and is out of scope.
