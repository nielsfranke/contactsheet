<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Proposal: optional auto-fill header image

**Status:** implemented (migration 0046) — instance-wide opt-in, seeded-stable non-cover pick,
watermark-aware, container-safe. Shipped as described below.
**Origin:** Matthias field feedback (2026-07-08): when no header/cover is set manually, let the
gallery auto-pick images so it looks finished out of the box.

## Problem / motivation

A freshly created gallery with photos but no manually chosen header shows an **empty hero**:

- **Showcase** renders a *text-only* opener (`GalleryPresentationLayout` — `header_image_url ? hero : text`).
- **Review** renders *no* banner at all (`GalleryCollabLayout` — `header_image_url && …`).

So galleries look unfinished until the photographer opens settings and sets a header by hand.

The **cover** does **not** have this problem — it already auto-falls-back to the first photo
(`gallery_repo.get_cover_image` → `order_by(sort_order).limit(1)`), so sub-gallery cards and link
previews always show an image. **This proposal is therefore about the header only.**

## Scope decision

Ship it as an **opt-in, instance-wide setting** (`app_settings`), default **off** — matching
Matthias's "as an option" framing and other presentation defaults that live in `app_settings`
(`gallery_sort`, `lightbox_backdrop`, `high_res_previews`, …). Per-gallery override is explicitly
**out of scope** for v1 (see below) to avoid churning the preset/cascade field lists.

## Design

### Display-time fallback, not a stored file

The header stays a manual "frozen pixel copy" as today. The auto-header is a **pure display-time
fallback computed in the serializer** — no baked file, no per-gallery DB write, no migration beyond
the one settings flag. A manually set header always wins; turning the setting off restores the
text opener instantly. This mirrors how the cover fallback already works (`_effective_cover_url`).

### Which photo (heuristic)

**Recommended default: a stable seeded pick that differs from the cover.**

- Cover = first photo (`sort_order` 0), unchanged.
- Header = a **deterministic** pick seeded by `gallery.id` into the gallery's live photo list,
  **excluding the cover photo** when the gallery has ≥2 photos. Seeded (not per-request random) so
  it is **stable** — otherwise the OG link-preview image would change on every scraper hit, caching
  would break, and it would read as a bug. Gives Matthias's "two different images" effect (banner ≠
  card) while staying stable per gallery and varied across galleries.
- Single-photo gallery → header = that photo (same as cover; acceptable).

**Rejected: per-request `random`** — unstable (breaks OG previews/caching, looks buggy) and can
surface a bad frame.

**Possible future upgrade:** once reviewing has happened, prefer the **highest-rated / most-liked**
photo as the auto-hero ("your best shot becomes the header"). Nicer than a seeded pick but depends
on ratings existing; deferred to keep v1 small.

### Rendition, focus, and watermark safety

- Use the photo's **`medium`** rendition (the hero is full-screen; `medium` = 1920 px is the right
  size and is what the OG path already uses).
- Focus point defaults to **center (50/50)** — the manual `header_focus_x/y` editor stays tied to a
  manual header only.
- **Must be watermark-aware.** Route the auto-header URL through the *same* watermark-aware image
  URL the public grid uses (the `{variant}-wm/` path when `watermark_service.is_active`), so an
  auto-header in a watermarked proofing gallery never leaks an un-watermarked full-screen view. (The
  manual header is deliberately un-watermarked branding; the auto-header is a client photo, so it
  must follow the gallery's watermark rule.)

### Container galleries

A container (`image_count == 0 && subgalleries > 0`) has no own photos → **skip** (keep the text
opener). Pulling a descendant's photo is out of scope for v1.

### API shape (no admin-side breakage)

Keep `header_image_url` = **manual header only** (admin UI, the "remove header" button, and the
focus-point editor all key off it — don't change its meaning). Add a separate resolved field to the
**public** gallery response, e.g. `header_image_fallback_url: str | None`, populated only when the
setting is on, the gallery has photos, and no manual header exists.

The public layouts then use `header_image_url ?? header_image_fallback_url`. All existing hero
styling (`opener_scrim`, title shadow/position, focus default 50/50) applies automatically because
the layout already branches on "is there a header image". Admin components are untouched.

### OG / link previews

**Unchanged** for v1. The OG path (`header file → uploaded cover → first photo`) already yields the
first photo, which is a fine preview. Making OG use the seeded auto-header is a nice-to-have but adds
surface for no real gain — deferred.

## Data model

One new column, migration **0046**:

- `app_settings.auto_header_enabled` — boolean, default `false`.

No gallery-table change (fallback is computed, not stored).

## Settings UI

One toggle under **Settings → Gallery defaults**: *"Auto-fill gallery header from photos when none
is set"* with a one-line helper. Wire through `admin_settings` router + `AppSettings` schema + the
settings page; add the i18n keys (en source of truth, run `validate-i18n.mjs`).

## Out of scope (future)

- Per-gallery override / preset field.
- Best-rated-as-hero heuristic.
- Smart crop / auto focus point.
- OG image using the auto-header.
- Container galleries pulling a descendant photo.

## Test plan

- **Backend:** serializer unit — setting off → `header_image_fallback_url` null; on + manual header
  → null (manual wins); on + no manual header + ≥2 photos → a stable non-cover photo, **same across
  two calls** (stability); on + watermark active → the `-wm` variant URL; container → null.
- **Frontend:** both layouts render a hero when only `header_image_fallback_url` is set; admin header
  editor still sees "no manual header".
- Migration up/down.

## Deployment impact

Plain image pull + `alembic upgrade head` (migration 0046 adds one `app_settings` column). **No
nginx/host-file change**, no reverse-proxy change. Existing installs are unaffected until an admin
turns the toggle on (default off).
