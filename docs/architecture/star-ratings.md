<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Star ratings (alternative to color flags)

> **Superseded in part** by [rating-mode-both.md](rating-mode-both.md): `rating_mode`
> now has a third value `"both"` that renders flags and stars side by side. The
> "never both at once" invariant below only holds for the `"flags"`/`"stars"` modes.

## Goal

Offer a classic **1–5 star rating** as an alternative to color flags, chosen by a
single **instance-wide setting**. Flags *or* stars, never both at once. Star mode
also supports per-reviewer ratings (the team-voting analog): each named reviewer
gives their own 1–5.

## The switch

New global setting `app_settings.rating_mode ∈ {"flags", "stars"}`, default
`"flags"` (every existing instance is unchanged). Surfaced in admin settings as a
two-way choice. It flips the *entire* instance: every gallery's rating feature
renders as flags or as stars accordingly.

The per-gallery gate is unchanged: `galleries.color_flags_enabled` keeps its name
but is **reinterpreted as the generic "ratings enabled" toggle** — in flags mode
it gates color flags, in stars mode it gates stars. (Renaming the column would
churn the cascade/preset/passthrough field lists for no behavioural gain; the
docs and UI labels carry the generic meaning instead.) `enable_team_voting`
likewise means "each reviewer rates individually" in both modes.

The interaction rules are preserved by analogy:
- **Shared rating** (team voting off): one value per photo, anyone overwrites.
- **Per-reviewer rating** (team voting on): one value per reviewer per photo.
- **Likes** stay hidden when team voting is on, in either mode.

## Data model

Stars live in their own columns next to the existing flag columns — the two never
coexist at runtime, but keeping both stored means switching modes is lossless
(your flags are still there if you switch back).

| Column | Type | Default | Meaning |
|---|---|---|---|
| `app_settings.rating_mode` | `String(10)` | `"flags"` | instance switch |
| `images.rating` | `Integer` | `0` | shared 1–5 (0 = unrated), parallels `color_flag` |
| `image_votes.rating` | `Integer` | `0` | per-reviewer 1–5 (0 = cleared), parallels `color_flag` |

**Migration 0039** adds all three (`server_default` each). The `image_votes`
unique constraint `(image_id, reviewer_name)` is unchanged — one row per reviewer
holds both their flag and their star, only the active-mode one is meaningful.

Pydantic: `RatingType = conint(ge=0, le=5)` (or `Literal[0,1,2,3,4,5]`). Add
`rating` to `ImageResponse`, the image update schema, `VoteCreate`/`VoteResponse`,
and `rating_mode` to the settings read/update schemas + `GalleryPublicResponse`
(the public client needs to know which mode to render).

## API

REST-first, reusing the existing rating verbs rather than inventing a parallel
tree:

- **Admin shared** — `PUT /api/images/{id}` already takes `color_flag`; add
  `rating`. Service clamps 0–5.
- **Public shared** — new `POST /g/{share_token}/images/{image_id}/rate`
  `{rating}` → sets `images.rating`, sibling to the existing `/flag` and `/like`
  (same response `ImageResponse`, same activity + notification + realtime
  `realtime_publish(..., "flag")` signal so the grid invalidates identically).
- **Per-reviewer** — `PUT /g/{share_token}/images/{image_id}/vote` gains an
  optional `rating`; `vote_repo.upsert` updates only the field(s) supplied, so a
  stars-mode reviewer writes `rating` and leaves `color_flag` untouched.
  `VoteResponse` returns both.

Serializers expose `rating` everywhere `color_flag` already appears (public image
serializer, admin image serializer, vote serializer).

## Frontend

- **New shared types**: `RatingMode = "flags" | "stars"`; `ImageResponse.rating`,
  vote `rating`. `rating_mode` arrives on the public gallery response and admin
  settings.
- **`StarRating` component** (`components/chrome/`): read-only display + an
  interactive 1–5 picker (hover-preview, click-to-set, click-same-to-clear),
  mirroring how the flag dot + flag picker work today. Drops into the three tiles
  that render a flag: `gallery/PhotoGrid` tile, `admin/admin-grid-tile`, and
  `gallery/Lightbox`. Each already owns a `localFlag` optimistic-state pattern
  (incl. the render-time external-sync fix from the flag-thumbnail bug) — the
  rating gets the identical treatment (`localRating` + `syncedRating`).
- **Mode gate**: a small `rating` feature flag derived from `rating_mode` +
  `color_flags_enabled` decides flag-vs-star rendering. `effectiveRating` mirrors
  `effectiveFlag`: per-reviewer value when team voting is on, else the shared one.
- **Toolbar** (`GalleryToolbar`): the flag-filter chips and group-by-flag become
  rating-aware. In stars mode: filter chips are the five star buckets (+ unrated),
  group-by switches to rating buckets, and a **sort-by-rating** key is added
  (useful for stars; also offered for flags for parity). `useGalleryView`'s
  `flagOf`/grouping generalize to `ratingValueOf`.
- **i18n**: `gallery.stars.*` (aria-labels "1 star"…"5 stars", "unrated"),
  settings labels for the mode switch and the reinterpreted toggle; en + de, then
  `validate-i18n.mjs`.

## Invariants

- Default `rating_mode="flags"` ⇒ every existing instance renders exactly as today.
- Flags and stars are **never shown together**; the global setting is the sole
  authority, read from `app_settings` (admin) and `GalleryPublicResponse` (public).
- Switching modes is **non-destructive** — flag and star values persist in their
  own columns across switches.
- Stars obey the same access/serialization path as flags: nothing bypasses the
  image serializer, moderation, or soft-delete.
- Real-time, activity logging, and notifications fire for star changes on the same
  signals as flag changes (the grid already invalidates on the `flag`/`vote`
  signals).

## Test coverage

Backend: `rating_mode` round-trip in settings; shared rate endpoint (clamp,
auth, gallery-gate); per-reviewer rating upsert (unique constraint, clear).
Frontend: extend the sort lib tests for rating sort; `StarRating` interaction.
