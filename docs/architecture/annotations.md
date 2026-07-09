# Annotations (anchored comment pins)

Status: **implemented** 2026-06-14. Phase 3, Feature 8. Migration `0027`.

> **Update (post-review):** shipped initially with Pin + Rectangle marks, then switched to a **single
> freehand pen** at the maintainer's request (the `anchor` JSON gained a `freehand` type carrying a
> normalized `points` path; `pin`/`rect` stay valid for backward-compat but aren't offered in the UI).
> Also added: numbered badges linking each mark to its comment row, bidirectional mark↔comment hover
> highlighting, edge-aware note-popover placement, and annotation-specific reviewer-name copy. The
> sections below describe the original Pin/Rectangle design; the data-model, gating, and serialization
> notes still hold — only the mark geometry and the toolbar changed.

Let clients (and the photographer) pin feedback to a **specific spot or area on a photo**: a
numbered **pin** for "look here" or a **rectangle** for "this region". Each mark carries a written
note, appears instantly to everyone with gallery access, and lives in the same feedback stream as
ordinary comments.

## Deliberately *not* "Scribbles"

Some gallery tools ship this as **"Scribbles"** — a *Scribble* button below the photo, two freehand
tools ("dots" and "lines"), and a "Comment and Save" button. We reject that framing on purpose:

- **Terminology** — the feature is **Annotations**; the existing scaffolded `scribbles_enabled`
  flag is renamed `annotations_enabled` (see Rename below). No "scribble" anywhere in code, UI, or
  i18n.
- **Model** — not a loose freehand-drawing layer bundled into one comment box. Instead, **vector
  marks anchored to the image**, where *each mark is a comment* (the Figma / Markup.io review-pin
  mental model). This reuses our comment infrastructure (storage, endpoints, notifications,
  activity, counts) rather than building a parallel "scribble" stack, and it keeps feedback as one
  threaded list instead of two.
- **Tools** — **Pin + Rectangle** as resolution-independent vectors, not freehand pixel paths.
  Freehand/arrow are explicit follow-ups, not v1.

## Data model — anchor on `comments`

An annotation **is a comment with a spatial anchor**. We add one nullable JSON column to the
existing `comments` table; a `NULL` anchor means an ordinary (unanchored) comment exactly as today.

```
comments.anchor  JSON  NULL
```

Anchor shape (validated by Pydantic — see Backend):

```jsonc
// Pin (a point):
{ "type": "pin",  "x": 0.42, "y": 0.31, "color": "#e11d48" }

// Rectangle (an area):
{ "type": "rect", "x": 0.10, "y": 0.20, "w": 0.25, "h": 0.18, "color": "#e11d48" }
```

- **Normalized coordinates** — `x/y/w/h` are fractions `0..1` of the image's *intrinsic* content
  box, so a mark maps onto any rendition (thumb / medium / original) and any display size. The
  frontend overlay translates them to the rendered `<img>`'s content rectangle (accounting for
  `object-contain` letterboxing).
- `color` is an optional `#rrggbb`; defaults to the instance accent. Bounded + enum-validated so a
  malicious client can't store a huge or malformed blob.
- A `pin` carries only `x/y`; a `rect` additionally requires `w>0, h>0` and `x+w<=1, y+h<=1`.

Why not a separate `annotations` table: it would duplicate the comment service/repo/router,
notifications, activity logging, and the per-image count plumbing — and split one feedback
conversation across two lists. Anchoring on comments is one migration and a much smaller surface
(decided with the maintainer).

## Rename: `scribbles_enabled` → `annotations_enabled`

The flag was scaffolded (migration `0007`) but never built. Rename every occurrence; no behavioural
change beyond the name:

| File | Line(s) | Change |
|---|---|---|
| `backend/app/models/gallery.py` | 68 | column `scribbles_enabled` → `annotations_enabled` |
| `backend/app/schemas/gallery.py` | 155, 221, 294 | `GalleryUpdate` / `GalleryResponse` / `GalleryPublicResponse` |
| `backend/app/services/gallery_service.py` | 44 | `_PASSTHROUGH_UPDATE_FIELDS` (stays cascaded to sub-galleries) |
| `frontend/src/lib/types.ts` | 66 | `Gallery.annotations_enabled` |
| `frontend/src/components/admin/gallery-settings-fields.tsx` | 285, 319 | live toggle (no longer `comingSoon`) |
| `frontend/messages/{en,de}.json` | `settings.*.scribbles` | new key `annotations` |

Not added to `GalleryPreset` (`schemas/settings.py`) — matches the current `scribbles_enabled`
handling (it's a niche sub-feature, configured per gallery, not via the mode presets).

## Backend

### Schema — `schemas/comment.py`

```python
class Anchor(BaseModel):
    model_config = {"extra": "forbid"}
    type: Literal["pin", "rect"]
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    w: float | None = Field(None, gt=0, le=1)
    h: float | None = Field(None, gt=0, le=1)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")

    # model_validator: rect requires w/h and x+w<=1, y+h<=1; pin forbids w/h.
```

- `CommentCreate.anchor: Anchor | None = None`
- `CommentResponse.anchor: Anchor | None = None` (serialized from the JSON column)

### Service / gating — `comment_service.add_comment`

- Pass `anchor` through to `comment_repo.create` (stored as JSON).
- Activity: log `"annotated"` (new verb) when `anchor` is present, else `"commented"` as today.
- Notification: reuse the existing **`comment`** event (an annotation is a comment); add
  `anchored: true` to `meta` so a future summary can distinguish. No new notification event type.

### Public gating — `routers/public.py::add_comment`

The single comments endpoint serves both. Add a guard:

- `body.anchor is not None` **and** `not gallery.annotations_enabled` → `403`
  `CodedHTTPException(code="annotations_disabled")` (frontend maps it to an `errors.*` string).
- Unanchored comments keep their existing `comments_enabled` gate.
- **Admin** (`routers/galleries.py` comment endpoint) may always annotate — it's a photographer
  tool, no gate.

**Rule: annotations require comments.** An annotation is a comment, so `annotations_enabled` only
does anything while `comments_enabled` is on (enforced in the UI by nesting/disabling the toggle,
and naturally on the backend since anchored rows are comments).

### Repository / counts

`comment_repo.create` gains an `anchor` kwarg. Anchored comments **count as comments**
(`comment_count`, `counts_for_images`, gallery totals) — no separate counter. The frontend derives
pins by filtering the already-loaded comment list to those with an `anchor`.

### Migration `0027`

One migration, two related changes:

1. `op.alter_column("galleries", "scribbles_enabled", new_column_name="annotations_enabled")`
   (SQLite 3.25+ supports `RENAME COLUMN`; use `batch_alter_table` for safety).
2. `op.add_column("comments", sa.Column("anchor", sa.JSON(), nullable=True))`.

## Frontend

### Loading anchors into the lightbox

Pins/rects must render on the image **without** opening the comment panel. Today `CommentPanel`
fetches comments lazily on open. We lift a comments query into `Lightbox` (same query key
`["comments", shareToken, imageId]` / `["admin-comments", galleryId, imageId]`, so it shares cache
with `CommentPanel`), enabled when annotations are active or the panel is open. Pins = the loaded
comments where `anchor != null`.

### Overlay + coordinate mapping

A new `AnnotationLayer` (`components/gallery/AnnotationLayer.tsx`) is absolutely positioned over the
rendered image. Because `object-contain` letterboxes, the layer measures the image's **content
rect** (from `naturalWidth/Height` + the element's client box) and positions marks as percentages
within that rect — a small `useRenderedImageRect` hook recomputed on load / resize / index change.

- **Pin** — a numbered circle at `(x, y)` in `color`.
- **Rect** — a 2px outlined box at `(x, y, w, h)` in `color`, faint fill.
- **Numbering** — marks ordered by `created_at`; the number ties a pin to its row in `CommentPanel`.
- **Interaction** — clicking a mark opens the comment panel and highlights/scrolls to its row;
  hovering a comment row highlights its mark. (Generic review-tool affordance.)

### Creating an annotation

Annotation mode lives in the lightbox **top toolbar** (next to the comments button) — *not* a
"Scribble button below the photo". A `PenLine`/pin icon toggles **annotate mode**; while active a
small inline palette shows **Pin · Area** + a color dot.

- **Pin** tool: click the image → drop a pin at that point.
- **Area** tool: drag on the image → draw a rectangle.
- On release, a compact **note popover** anchors to the new mark with a text field (+ the
  reviewer-name prompt, reusing the existing voting/reviewer store like flags/uploads do). Submit →
  `addComment({ text, author_name, anchor })`; cancel → discard the pending mark.
- Optimistic: the pending mark renders immediately; on success we invalidate the comments query and
  `["public-images" | "gallery-images"]` (so `comment_count` badges refresh).

Available in **both** the public collaboration lightbox (gated by `annotations_enabled`) and the
admin in-gallery lightbox (always, as a photographer tool, via `adminGalleryId`).

### Settings toggle

In `ReviewFields` (`gallery-settings-fields.tsx`) the Annotations toggle becomes **live** and is
**nested under Comments** (indented), disabled when `comments_enabled` is off — making the
"annotations require comments" rule visible. Mirrors how `comments_enabled` already flows through
`GalleryUpdate` and the sub-gallery cascade.

### API client / types

- `CommentCreate` (and `Comment`) types gain `anchor?: Anchor`. `Anchor` added to `lib/types.ts`.
- `api.public.addComment` / `api.galleries.addImageComment` already forward the body — no signature
  change beyond the type.

### i18n

- Rename `settings.*.scribbles` → `annotations` (en + de).
- New keys under `gallery.annotations.*`: `annotate`, `tools.pin`, `tools.area`, `addNote`,
  `hint` (e.g. "Click to pin · drag to mark an area"), plus `errors.annotations_disabled`.
- Run `cd frontend && node scripts/validate-i18n.mjs` before committing catalog changes.

## Security / trust model

Same unauthenticated, self-asserted-name model as comments/flags/collections: anyone with gallery
access (and the password, if set) may annotate; `author_name` is trusted as given. New surface is
the `anchor` blob, fully bounded by the `Anchor` schema (enum type, floats clamped to `0..1`, rect
containment, hex color, `extra="forbid"`), so it can't carry oversized or arbitrary data. No new
rate limiting (inherits the comment endpoint's existing posture).

## Out of scope / follow-ups

- **Freehand pen & arrow** tools (freehand pixel-paths — the part closest to a "lines" tool).
- **Editing / moving** an existing anchor, or deleting your own annotation (today comments aren't
  client-deletable either).
- **Resolve / done** state per annotation (review workflow).
- **Video annotations** (frame-timed anchors).
- **Presentation-mode** annotations — review (collaboration) mode only, like all client feedback.
- **Annotation export** (burned-in onto a downloaded JPEG / contact sheet).
