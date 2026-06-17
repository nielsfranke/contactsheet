# Client uploads

Status: **implemented** — 2026-06-13

Let gallery visitors contribute photos to a gallery. Activates the existing (scaffolded but
"not built") `client_upload_enabled` per-gallery toggle. Uploaded photos appear in the gallery
**immediately, visible to everyone**, attributed to the uploader's reviewer name.

## Decisions (locked with the user)

- **Visibility**: uploads are public the moment they finish processing — same grid as the
  photographer's photos, seen by all visitors (like flags/likes/comments). No moderation queue,
  no hidden/admin-only state.
- **Attribution**: each upload records the uploader's name (reused from the voting reviewer-name
  store) in a new `Image.uploaded_by` column, surfaced in the admin grid. A required name also
  lets the admin tell client uploads (`uploaded_by` set) from their own (`uploaded_by` null).
- **Limits**: same MIME allow-list (JPEG/PNG/WebP), magic-byte check, and per-file size cap as
  admin uploads, **plus** a per-request count cap (50 files).

## Backend

- **Model / migration** — add `Image.uploaded_by: Mapped[str | None]` (`String(100)`, nullable,
  default null). Migration `0017`. Admin uploads leave it null.
- **`ImageResponse`** — add `uploaded_by: str | None = None` (already flows through
  `_image_to_response` via `**image.__dict__`).
- **`image_service.upload_images`** — add an `uploaded_by: str | None = None` parameter, passed
  to `image_repo.create`. Admin router call is unchanged (defaults to null).
- **`image_service.client_upload_images(db, gallery, files, uploader, storage, bg)`** — service
  wrapper that enforces business rules (keeps the route handler thin):
  - 403 if `not gallery.client_upload_enabled`.
  - 400 if `len(files) > 50` (count cap).
  - trims `uploader`; falls back to `"Guest"` when blank.
  - delegates to `upload_images(..., uploaded_by=uploader)`.
- **Public endpoint** — `POST /api/public/g/{share_token}/images` (multipart: `files`,
  `uploader` form field):
  - resolve gallery via `get_public_gallery`, then `_require_gallery_access` (password gate, same
    as every other public write).
  - call `client_upload_images`; return the `list[UploadResponse]`. Processing runs via the
    router's `BackgroundTasks`, identical to admin upload.
- `client_upload_enabled` is **already** on `GalleryPublicResponse`, so the client knows whether
  to show the affordance — no schema change there.

### Security notes

The endpoint is a public write, so: it is inert unless the photographer flips
`client_upload_enabled`; it honours the gallery password; MIME + magic-byte + size + count caps
apply; files are stored UUID-named under the gallery dir (path-traversal-safe `LocalStorage`).
**Accepted trade-offs:** there is no app-wide rate limiter today (caps mitigate; a per-IP limit is
a follow-up), and the "visible immediately" model means a bad-faith visitor could post images all
viewers see — the photographer deletes them in admin. Both are inherent to the chosen model and
noted, not solved here.

## Frontend

- **Types** — `ImageResponse.uploaded_by: string | null`. `CollaborationValues` (in
  `gallery-settings-fields.tsx`) gains `client_upload_enabled`.
- **Settings toggle** — in `CollaborationFields`, replace the disabled "Coming soon" Client upload
  row with a live `Toggle` bound to `value.client_upload_enabled` / `onChange`. `GallerySettingsModal`
  already cascades it (`apply_to_subgalleries`) and `PATCH /api/galleries/{id}` already accepts it.
  `PresetEditorModal` keeps it out of scope (instance presets don't configure client upload yet) —
  done by leaving `client_upload_enabled` off the preset's collaboration values, so the shared
  component renders the live toggle only where the parent supplies the field.
- **API client** — `api.public.uploadImages(token, files, uploader, galleryToken?, onProgress?)`:
  XHR + `FormData` (mirrors the admin `api.images.upload` for progress), posting to the public
  endpoint with `authHeaders(galleryToken)`.
- **Public UI** (`GalleryView`) — when `gallery.client_upload_enabled`, show an **"Add photos"**
  button (both presentation and collaboration layouts). Flow:
  1. require a reviewer name — reuse `ReviewerNamePrompt` / `useReviewerStore`; if unset, prompt
     before opening the file picker.
  2. hidden `<input type="file" multiple accept="image/*">` → upload via the API client with an
     aggregate progress indicator (toast or inline bar).
  3. on success, invalidate the `["public-images", shareToken]` query so the new photos appear;
     toast the count.
- **Admin surface** — `AdminImageGrid` tiles show a small "↑ {uploaded_by}" badge when
  `uploaded_by` is set, so the photographer can spot client contributions. (Filtering by uploader
  is a follow-up.)

## Out of scope / follow-ups

- Moderation / approval queue, admin-only (private) uploads.
- Per-IP rate limiting on the public endpoint.
- Configuring client upload via instance presets; filtering the admin grid by uploader.
- A dedicated "Client uploads" sub-gallery destination.
- Video / RAW uploads (same format set as admin today).
