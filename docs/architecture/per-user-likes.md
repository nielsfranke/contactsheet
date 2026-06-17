<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Per-reviewer likes (one like per person, toggleable)

**Status:** implemented (2026-06-16)

## Problem

A photo "like" is a bare counter (`Image.likes`, incremented by
`image_service.public_increment_like`). Tapping the heart **adds another like
every time** — a single visitor can run the count up indefinitely, and there's
no way to **un-like**. Likes should be **one per person, toggleable**.

## Model to mirror

Team voting already solves exactly this shape: `ImageVote` (`image_votes`) is
keyed `UniqueConstraint(image_id, reviewer_name)` and upserted per reviewer. The
reviewer identity is the same unauthenticated, name-based model used by flags /
comments / collections (`useReviewerStore` on the client). Likes adopt the same
approach.

## Design

### Data (migration 0034)

New `image_likes` table, mirroring `image_votes`:

- `id` (uuid PK), `image_id` (FK → images, cascade), `gallery_id`
  (FK → galleries, cascade, indexed), `reviewer_name` (String 255),
  `created_at`.
- `UniqueConstraint(image_id, reviewer_name)` → at most one like per person per
  photo.

**`Image.likes` stays as the displayed count** (denormalised), maintained on
toggle (`+1` on like, `-1` on unlike, floored at 0). This **preserves existing
counts** (legacy likes have no per-reviewer rows but still show); new likes are
deduplicated and attributable. (Deriving the count purely from rows would zero
out all pre-existing likes — rejected.)

### Backend

- **`like_repo`** — `toggle(db, image_id, gallery_id, reviewer) -> bool`
  (returns the new liked state): if a row exists, delete it + decrement
  `Image.likes`; else insert + increment. `liked_image_ids(db, gallery_id,
  reviewer) -> list[str]` for the "what have I liked" fetch.
- **`image_service.public_toggle_like`** replaces `public_increment_like`:
  toggles, returns the updated `Image` + the new liked bool. Notification +
  activity are enqueued **only when liking** (not on un-like), keeping the
  existing `flag`-bucket notification behaviour without un-like noise.
- **Endpoints** (`public.py`):
  - `POST /g/{share_token}/images/{image_id}/like` — body `{reviewer}` (→ 422 if
    blank; same trust model as flags). Toggles; returns the updated
    `ImageResponse`. Rate limit unchanged (`120/minute`).
  - `GET /g/{share_token}/likes?reviewer=` — `list[str]` of image_ids the
    reviewer has liked (mirrors `GET …/votes`). Access-gated.
- Realtime: the like toggle keeps publishing the existing `"image"` signal so
  other viewers' counts refresh; the per-reviewer liked-set is local/optimistic.

### Frontend

- **Reviewer name now required to like** (it's how we dedupe) — tapping the heart
  with no name set opens the existing `ReviewerNamePrompt`, exactly like color
  flags do today.
- **Liked-set** — `useGalleryView` loads `["public-likes", shareToken,
  reviewerName]` (`api.public.getLikes`) into a `Set<imageId>`, threaded to
  `PhotoGrid` + `Lightbox`. The heart renders **filled when *I* liked it**
  (`liked.has(img.id)`), not when `likes > 0`.
- **Toggle** — `api.public.likeImage(shareToken, imageId, reviewer, token)`
  returns the updated image; optimistic update flips the local liked-set and
  count, reverting on error. Replaces the current increment-only mutation in
  both `PhotoGrid` and `Lightbox`.

## Migration / compatibility

- Existing `Image.likes` values are preserved as the starting count; no backfill
  of `image_likes` rows (legacy likes simply aren't attributable to a person).
- A returning visitor using the same reviewer name sees their prior likes only
  for likes made *after* this ships (legacy ones aren't theirs to toggle) — an
  acceptable one-time transition.

## Files touched

| File | Change |
|---|---|
| `backend/app/models/like.py` | **new** — `ImageLike` |
| `backend/app/models/image.py` | `likes` relationship (optional, for cascade) |
| `backend/alembic/versions/0034_*.py` | `image_likes` table |
| `backend/app/repositories/like_repo.py` | **new** — toggle + liked-ids |
| `backend/app/services/image_service.py` | `public_toggle_like` (replaces increment) |
| `backend/app/routers/public.py` | toggle body + `GET …/likes` |
| `backend/app/schemas/...` | `LikeRequest{reviewer}` |
| `frontend/src/lib/api.ts` | `likeImage(reviewer)` + `getLikes` |
| `frontend/src/components/gallery/useGalleryView.ts` | load liked-set |
| `frontend/src/components/gallery/PhotoGrid.tsx` / `Lightbox.tsx` | filled-when-mine + toggle + name prompt |

## Out of scope

- Showing *who* liked (just counts + my-state).
- Likes in presentation mode (collaboration/review only, unchanged).
- Reconciling/​attributing legacy counter likes.

No new dependency. One migration (0034).
