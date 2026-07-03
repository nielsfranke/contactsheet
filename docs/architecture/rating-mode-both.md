<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Rating mode "both" — stars & color flags together

## Goal

Allow an instance to run **color flags and 1–5 stars at the same time**, as an
optional third choice of the existing instance-wide rating style setting. The
classic culling combo: flags for pick/reject sorting, stars for quality grading.

## The switch

`app_settings.rating_mode` gains a third value: `"flags" | "stars" | "both"`.
No migration — the column is already `String(10)` with default `"flags"`; only
the Pydantic `Literal` in `schemas/settings.py` widens. Default unchanged, so
every existing instance renders exactly as today.

The per-gallery gate stays `color_flags_enabled` (the generic "ratings enabled"
toggle, as established by star ratings) — in `both` mode it gates **both** UIs
at once. `enable_team_voting` likewise applies to both: each reviewer gets their
own flag *and* their own star (one `image_votes` row already holds both).

## Why the backend is (almost) free

The star-ratings design (migration 0039) deliberately stored flags and stars in
**parallel columns** (`images.color_flag` + `images.rating`,
`image_votes.color_flag` + `image_votes.rating`) and never gated the endpoints
by mode — `/flag`, `/rate`, and `/vote` (partial upsert: writes only the field
sent) all work regardless of `rating_mode`. "Both" is therefore purely a
rendering change:

- `schemas/settings.py`: `rating_mode: Literal["flags", "stars", "both"]`.
- Everything else (models, routers, services, serializers, activity,
  notifications, realtime, analytics engagement counting) is untouched.
- Test: settings round-trip accepts `"both"`; existing flag/rate/vote tests
  already cover simultaneous writes.

## Frontend

### Mode gate

`RatingMode = "flags" | "stars" | "both"` in `lib/types.ts`. Every render site
currently derives one boolean (`const stars = ratingMode === "stars"`); replace
with two:

```ts
const showStars = ratingMode !== "flags";   // stars or both
const showFlagUI = ratingMode !== "stars";  // flags or both
```

In `flags`/`stars` mode exactly one is true → all existing layouts are
byte-identical. Only `both` renders the new combined layouts below.

### Tile layout (PhotoGrid + admin-grid-tile)

Both pickers live top-right today. In `both` mode they stack in one
`flex flex-col items-end gap-1.5` container top-right:

- **Hover toolbar**: star picker (row 1) above the flag-dot row (row 2) — stars
  first because they're the wider, more finger-friendly target and align with
  the persistent badge position.
- **Persistent badge** (resting, hide-on-hover): one row — flag dot (when set)
  to the left of the star row (when rated), sharing the existing
  ring/drop-shadow treatment. Shows whichever subset is set.

### Lightbox

- **Badge** (top area): same combined row as the tile — flag dot + stars.
- **Bottom toolbar**: currently star picker *or* flag dots in the same slot;
  in `both` mode render both, flags left of stars with the existing gap. The
  toolbar row has room on desktop; on mobile the lightbox already wraps its
  action cluster — verify at 360 px and, if tight, shrink the flag dots to the
  `sm` size in both mode.

### Toolbar (filter / sort / group)

- **Filter chips**: show flag chips *and* star chips (both inline and in the
  filter popover, as two labelled rows). Filtering already ANDs the two sets in
  `useGalleryView` (`flagFilters` ∩ `ratingFilters`) — no logic change.
- **Sort**: the `rating` sort key is offered whenever `showStars`.
- **Group by**: keys become `none | flag | rating` when both are visible (the
  two bucketings are mutually exclusive per group pass, so the user picks one).
- **Bug fix rolled in**: `useGalleryView.filterActive` omits
  `arrange.ratingFilters` — today in stars mode a star-filtered "download"
  downloads *everything*. Add `|| arrange.ratingFilters.size > 0`.

### Settings UI

Settings → Gallery defaults: the two-way rating-style choice becomes three
buttons; the `both` button shows the two flag dots + the star glyph side by
side. Same immediate-save behaviour.

### i18n

`settings.ratingMode.both` label + hint (en + de), any new aria-labels for the
combined badge. Run `node scripts/validate-i18n.mjs`.

## Invariants

- Default and both existing modes are **pixel-identical** to today; `both` is
  pure opt-in.
- Non-destructive in every direction: switching between the three modes never
  converts or clears either value system (unchanged from star ratings).
- The two systems stay independent — no coupling rules (setting a star never
  touches the flag, and vice versa), matching Lightroom/Capture One semantics.
- Likes remain hidden when team voting is on, in all three modes.
- `docs/architecture/star-ratings.md` "never both at once" invariant is
  superseded by this doc (amend its header note) and the `CLAUDE.md` feature
  invariant is updated.

## Test coverage

- Backend: `rating_mode="both"` settings round-trip (+ reject unknown values).
- Frontend: extend the sort-lib tests only if grouping logic changes;
  `filterActive` rating-filter fix gets a Vitest case if the helper is
  extractable, otherwise covered by E2E.
- Manual pass: tile hover, lightbox toolbar at mobile width, team voting with
  both values on one vote row, filter AND semantics.
