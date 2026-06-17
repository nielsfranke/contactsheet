# Client upload moderation (approval queue)

Status: **implemented** — 2026-06-15

Adds an optional per-gallery **approval queue** for client uploads. Closes the "visible
immediately to everyone" trade-off called out in [`client-uploads.md`](./client-uploads.md):
when a photographer enables moderation, client-contributed photos land in a **pending** state —
invisible to the public — until the photographer approves them. Admin (photographer) uploads are
never moderated.

Builds directly on the shipped client-upload feature (migration `0017`) and reuses the existing
soft-delete, notification (Apprise outbox), realtime, and activity-log machinery.

## Decisions (locked with the user)

- **Reject = soft-delete.** Rejecting a pending upload reuses the existing `image_repo.soft_delete`
  path (`deleted_at`); the file is pruned by normal cleanup. No separate "rejected" archive — only
  two live states (`pending` / `approved`), nothing extra to render.
- **Pending uploads notify the photographer.** A new `"upload"` notification event fires (coalesced
  through the existing outbox/flush) so the photographer is pinged that a moderated gallery has
  photos awaiting review.
- **Moderation is opt-in per gallery**, off by default — existing galleries and the current
  "instant" behaviour are unchanged until the toggle is flipped.
- **Only client uploads are moderated.** Admin uploads are always `approved`. Moderation only
  applies when *both* `client_upload_enabled` and the new moderation toggle are on.

## Data model

Migration **`0029`** (two columns, no new table):

- `images.moderation_status: Mapped[str]` — `String(10)`, NOT NULL, server default `"approved"`.
  Values: `"approved"` | `"pending"`. Existing rows backfill to `"approved"` via the server
  default, so nothing already uploaded is hidden.
- `galleries.client_upload_moderation: Mapped[bool]` — `Boolean`, NOT NULL, server default
  `false`. The per-gallery switch.

Rejection does **not** introduce a third value (reject → `soft_delete`, the row leaves every view).

## Backend

### Write path

- `image_service.upload_images(...)` — add a `moderation_status: str = "approved"` param, passed to
  `image_repo.create`. The admin router call is unchanged (defaults to `"approved"`).
- `image_service.client_upload_images(...)` — compute
  `status = "pending" if gallery.client_upload_moderation else "approved"` and forward it. When
  `pending`, enqueue the new notification (see below). Returns the same `list[UploadResponse]`.
- `process_image` (the Pillow task) is **unchanged** — it doesn't know about moderation; it still
  publishes the realtime `"image"` signal on completion (see Realtime).

### Read path — hide pending from the public

The public listing and the public `image_count` must exclude `pending`; the admin sees everything.

- `image_repo.get_by_gallery(db, gallery_id, only_approved: bool = False)` — when `only_approved`,
  add `Image.moderation_status == "approved"` to the existing `deleted_at IS NULL` filter.
- `gallery_repo.count_images` / `batch_image_counts` — add the same `only_approved` param.
- **Public callers pass `only_approved=True`:** `gallery_service.get_public_gallery` (and the
  batch tree counts it builds) for `image_count`, and `image_service.list_images` when called from
  the public `get_public_images` route (thread an `only_approved` flag, defaulting `False`).
- **Admin callers pass `only_approved=False`** (default) — the photographer's in-gallery grid and
  the `/admin/galleries` overview counts include pending uploads, so they're reviewable inline.

The container-vs-content gate (`image_count === 0 && subgalleries > 0`) then treats a gallery whose
only photos are pending as **empty** publicly — correct.

### Moderation endpoints (admin)

In `app/routers/images.py` (admin-authed, same as upload/delete):

- `POST /api/galleries/{id}/images/{image_id}/approve` → `image_service.approve_image` sets
  `moderation_status="approved"`, logs an `"approved"` activity, publishes realtime `"image"` (so
  the public room now refetches and sees it), returns the updated `ImageResponse`.
- `POST /api/galleries/{id}/images/approve` (bulk) — body `{ image_ids: [...] }`, approves a batch
  in one call (the review tray's "Approve all"/multi-select).
- **Reject** reuses the existing `DELETE /api/galleries/{id}/images/{image_id}` (soft-delete) — no
  new endpoint; the UI just labels it "Reject" for pending rows. A bulk reject rides the existing
  per-image delete in a loop client-side (or a small bulk-delete helper if we want one call).

### Schema exposure

- `ImageResponse.moderation_status: str = "approved"` — flows through `_image_to_response` via
  `**image.__dict__`. Lets the admin grid badge/segregate pending tiles.
- `GalleryPublicResponse.client_upload_moderation: bool` — so the public upload UI can message the
  uploader "awaiting the photographer's approval" instead of showing a photo that won't appear.
  (Low-sensitivity boolean; consistent with `client_upload_enabled` already being public.)
- `GalleryUpdate.client_upload_moderation: bool | None` — accepted by `PATCH /api/galleries/{id}`;
  added to the `_PASSTHROUGH_UPDATE_FIELDS` cascade list so `apply_to_subgalleries` carries it.
  **Not** added to `GalleryPreset` (operational per-gallery switch, same treatment as
  `client_upload_enabled` / `notifications_enabled`).

### Notifications

- `schemas.notifications`: add `"upload"` to `EVENT_KEYS` and a field on `NotificationEvents`.
- `notification_service`: enqueue `event_type="upload"` from `client_upload_images` when the upload
  is `pending` (author = uploader name, `meta.count` = number of files). Same early-return guards
  (global enabled ∧ event on ∧ gallery switch on) and never raises into the request.
- Flush summary: add a `📤 N photo(s) awaiting review` line (rare-event itemisation style, like
  comment/annotation). Surfaced as a toggle in `/admin/settings/notifications`.

### Realtime

No new signal type. `process_image` keeps publishing `"image"` to the gallery room:

- **Admin** room refetch returns the pending image (admin list isn't `only_approved`) → it appears
  in the review tray.
- **Public** room refetch is `only_approved` → pending image is filtered out, so nothing leaks; the
  signal is a harmless no-op until approval. On **approve**, the approve endpoint publishes `"image"`
  again and the public room now picks it up. Matches the existing best-effort, self-healing model.

## Frontend

- **Types** — `ImageResponse.moderation_status: "approved" | "pending"`;
  `GalleryPublicResponse.client_upload_moderation: boolean`; add `client_upload_moderation` to the
  gallery settings values type.
- **Settings** (`GallerySettingsModal` → General tab) — a live **"Require approval for client
  uploads"** toggle nested under the existing Client upload toggle (disabled/hidden when client
  upload is off). Passed as a render-prop like `clientUpload`/`sets`/`annotations` so it stays out
  of the `extra="forbid"` preset payload.
- **Admin review** (`app/admin/galleries/[id]` + `GalleryAdminSidebar`) — pending tiles in
  `AdminImageGrid` get a **"Pending"** `OverlayPill` badge and hover **Approve** / **Reject**
  actions; the sidebar gains a filter chip / count ("N pending") that filters the grid to pending,
  with **Approve all** / multi-select approve (reusing `useImageSelection`). Reject reuses the
  existing tile delete, relabelled for pending rows.
- **Public upload UX** (`ClientUploadButton`) — when `gallery.client_upload_moderation`, the
  success toast reads "Uploaded — awaiting the photographer's approval" and we **skip** the
  re-invalidate that would otherwise try to surface the (still-hidden) photo. When moderation is
  off, behaviour is unchanged (invalidate `["public-images", token]`, "Added N photos").
- **API client** — `api.images.approve(galleryId, imageId)` and `api.images.approveBulk(galleryId,
  imageIds)`; reject reuses `api.images.delete`.

## Security / trade-offs

- Pending images are filtered from the public listing and public `image_count`, but their
  `thumb`/`medium` variant endpoints serve by `image_id`. A guessed UUID could still fetch a pending
  thumbnail — the same low-risk surface as today's unguessable-UUID model; not gated here. (A future
  hardening could 404 variants for `pending` on the public proxy.)
- The public **cover** queries (`get_cover_image` / `batch_cover_images`) are *not* `only_approved`.
  In practice a pending upload can't auto-become a cover (client uploads append to the end, covers
  pick the lowest `sort_order`) — only an explicit admin pin could, which is deliberate. Left ungated
  to avoid complicating the shared cover query; noted, not solved.
- Still no app-wide / per-IP rate limiter (size + 50-file caps mitigate) — unchanged from
  `client-uploads.md`, out of scope here.

## Out of scope / follow-ups

- A distinct "rejected" archive with restore (we soft-delete instead).
- Per-IP rate limiting; configuring moderation via instance presets.
- A dedicated moderation **inbox screen** (we surface review inline in the gallery grid instead).
- Notifying the uploader when *their* upload is approved/rejected.
- 404-ing pending variant endpoints on the public proxy.
