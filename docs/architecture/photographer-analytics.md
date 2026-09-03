# Photographer analytics dashboard

Status: **implemented** · Migration: **none** · 2026-06-25

Surface the engagement ContactSheet already records as a read-model: a
per-gallery analytics view plus an instance-wide rollup. This is purely
**derived from the existing `activities` table** — no new writes, no schema
change. It tells a photographer *how a delivery is landing*: is the client
opening it, downloading, picking favourites, leaving comments.

## What we already log (the source of truth)

Every analytics number comes from `activities` (`app/models/activity.py`),
indexed on `(gallery_id, created_at)`. Existing actions and where they're
written:

| action | per-image? | meta | when |
|---|---|---|---|
| `viewed` | no | — | gallery open, **only when IP logging is on**, deduped per IP / 30 min |
| `downloaded` | no | `{count}` | ZIP export / public stream (gallery-level) |
| `uploaded` | yes/no | `{count}` for batch | client uploads |
| `flagged` | yes | `{flag}` | color flag set |
| `rated` | yes | `{rating}` | star rating |
| `liked` | yes | — | per-reviewer like |
| `voted` | yes | `{...}` | team-voting flag/star |
| `commented` / `annotated` | yes | — | comments & anchored annotations |
| `approved` | yes/no | `{count}` | admin moderation (admin-side) |
| `collection` | no | `{name}` | collection created |

### Two honesty constraints baked into the data

These are the most important design facts — the UI must not pretend otherwise:

1. **Views depend on IP logging.** `viewed` rows are written *only when
   `app_settings.activity_ip_logging` is on* (off by default) — without an IP a
   view is neither dedupable nor informative, so `activity_service.log_view`
   no-ops. **Consequence:** "views over time" and "who opened" are empty until
   the admin opts in. The dashboard shows an inline prompt linking to
   Settings → General when views are unavailable, rather than a misleading empty
   chart. **Downloads, flags, likes, ratings, comments do not depend on IP
   logging** and are always present.

2. **Downloads are gallery-level, not per-image.** `downloaded` is one row per
   ZIP/stream request carrying `{count}` files — there is no per-image download
   record. So there is **no "most-downloaded photo"** to show. Instead the
   "Top photos" panel ranks by **per-image engagement** (flags + likes + ratings
   + comments, all of which carry `image_id`), which is the honest proxy for
   "what the client cared about". Download *volume over time* and *totals* are
   shown at the gallery level.

Privacy: IPs are already scrubbed after `activity_ip_retention_days`
(`activity_repo.scrub_ips_before`). Analytics **aggregates** and never exposes
more than the existing Activity feed already does; the visitor panel reuses the
same rows the feed shows.

## Layers (router → service → repository)

No business logic in routers; aggregation SQL lives in a new repo.

### Repository — `app/repositories/analytics_repo.py`

Pure aggregation queries over `activities` (+ a join to `images` for hydrating
top photos). All scoped by `gallery_id` or a gallery subtree. Functions:

- `summary(db, gallery_id) -> dict` — totals per action (single grouped count).
- `timeseries(db, gallery_id, action, days, tz_offset) -> list[(date, count)]` —
  daily buckets for `viewed` and `downloaded` over the last *N* days. Bucketing
  via `date(created_at, :offset)` so the SQLite `(gallery_id, created_at)` index
  is usable; zero-fill missing days in Python (don't trust SQL to emit gaps).
- `top_images(db, gallery_id, limit) -> list[(image_id, score, breakdown)]` —
  group engagement actions by `image_id`, ordered by count; excludes
  soft-deleted images via the join.
- `recent_visitors(db, gallery_id, limit) -> list[Activity]` — recent `viewed`
  rows (IP + time), only meaningful when IP logging is on.
- Instance rollup variants: `instance_summary`, `busiest_galleries(db, limit)`
  — same queries grouped by `gallery_id` across all non-deleted galleries.

Subtree scoping reuses the existing gallery-descendant helper (the same one
semantic search / ZIP use) so a parent gallery's analytics can optionally
include children — **v1 keeps it single-gallery** (no subtree) to match the
Activity feed's scope; subtree rollup is a noted follow-up.

### Service — `app/services/analytics_service.py`

Assembles the read-model the routers return: calls the repo, hydrates
`top_images` through the **normal `image_service` serializer** (so
soft-delete/moderation/watermark rules apply — embeddings-style discipline),
attaches the `views_available` flag (= IP logging on), and zero-fills
timeseries. No caching in v1 (queries are indexed and bounded; revisit if a
huge instance shows it).

### Router — `app/routers/analytics.py` (admin-only)

- `GET /api/galleries/{gallery_id}/analytics?days=30` → `GalleryAnalytics`
- `GET /api/admin/analytics?days=30` → `InstanceAnalytics`

Both behind `get_current_admin`. New schemas in `app/schemas/analytics.py`
(`GalleryAnalytics`, `InstanceAnalytics`, `TimeseriesPoint`, `TopImage`,
`EngagementTotals`). Mounted in `app/main.py`.

## Frontend

Charts are **hand-rolled inline SVG/CSS** — no new dependency (consistent with
keeping the image light). Two small reusable primitives under
`src/components/admin/analytics/`:

- `BarTimeseries` — daily bars with hover tooltip (date + count), responsive
  width, theme tokens. Used for views & downloads.
- `StatTile` — big-number + label + optional delta, for totals.

API client: add `api.analytics.gallery(id, days)` and `api.analytics.instance(days)`
to `src/lib/api.ts`. Types in `src/lib/types.ts`.

### Per-gallery

The gallery detail page already opens **Activity** as a dialog
(`onActivity` → `ActivityFeed`). Add an **Analytics** entry alongside it
(reuse the same dialog/sheet shell, tabbed: *Analytics · Activity*). Contents:

- `StatTile` row: views (or "enable IP logging" prompt), downloads, likes/flags,
  comments.
- `BarTimeseries`: views & downloads over the selected window (7/30/90 day
  toggle).
- **Top photos**: thumbnails ranked by engagement, each with its breakdown.
- **Recent visitors**: list of `viewed` rows (time + IP), shown only when IP
  logging is on; otherwise the enable-prompt.

### Instance rollup — `/admin/analytics`

New top-level admin page (nav entry beside Galleries/Settings; lazy, admin-only):
instance totals (`StatTile` row), a **busiest galleries** table (views/downloads/
engagement, linking into each gallery), and a downloads/views timeline across all
galleries. Reuses the same primitives.

## i18n

All labels in `en.json` under `analytics.*`; validate with
`node scripts/validate-i18n.mjs` before commit. Backend stays English.

## Testing

- Backend: `analytics_repo` aggregation correctness (seed activities → assert
  summary/timeseries/top_images), the IP-logging-off path (views empty,
  `views_available=false`), soft-deleted images excluded from top photos,
  admin-only auth on both endpoints.
- Frontend: Vitest for the timeseries zero-fill / bar-scaling helper (pure fn,
  extracted like the justified-layout math was).

## v2 additions (2026-09-03)

The first cut windowed only the two timeseries; everything else was all-time, so
the 7d/30d/90d selector silently didn't apply to totals or rankings. v2 makes the
window the contract and adds the "so what" layer photographers asked for.

- **Everything activity-derived is windowed** — `summary`, `top_images`,
  `busiest_galleries` and the reviewer rankings all take `since`. The service
  computes `_windows(days)` → `(since, previous_since)` once.
- **`previous_totals`** — the same totals for the equally long window *before*
  `since` (`[since − days, since)`), so every `StatTile` shows a period-over-
  period trend (`lib/analytics.trend`: `+40 %`, `−12 %`, `new` when the prior
  window was empty, nothing when both are). Muted tiles (views without IP
  logging) never show a trend.
- **`engagement_series`** — daily sum of `ENGAGEMENT_ACTIONS`, a third chart
  beside views/downloads. `timeseries` / `instance_timeseries` now accept one
  action *or* a tuple.
- **`top_reviewers`** (gallery + instance) — named clients ranked by what they
  did (`REVIEWER_ACTIONS` = engagement + `uploaded`), with a per-action
  breakdown and `last_active`. `_NON_REVIEWER_AUTHORS` drops the anonymous
  rows: `Guest` (views/downloads), `client` (the *shared* flag/rate path, which
  carries no reviewer name) and the photographer (`Admin`/`admin`). A gallery
  reviewed only through shared flags therefore lists **no** reviewers — honest,
  not a bug.
- **`review_status`** (gallery only) — the one block that is a **snapshot, not
  history**: reads `images` / `image_votes` / `image_likes` / `comments`
  directly for the live (non-deleted) images. Shared flag split (all five
  colours), shared star histogram (index 0 = unrated), images with likes /
  comments, distinct team voters, and `reviewed` = images carrying *any* mark.
  The activity log can't answer "where does the selection stand?" — a flag set
  then cleared logs two rows but ends at `none`. Which of flags/stars the panel
  renders follows `app_settings.rating_mode` (`showsFlags` / `showsStars`).
- **`GalleryRollup.engagement`** — per-photo engagement only; the busiest table
  uses it instead of re-deriving the sum client-side. `score` stays all
  activity.
- **Tiles**: `uploads` and `votes` appear only when non-zero in either window.

Frontend pieces: `ReviewStatusPanel`, `ReviewersTable` (feature columns nobody
used in the set collapse), `StatTile` trend, and `TotalsRow` gained
`previous` + `days`.

## Out of scope (v1, noted follow-ups)

- Per-image download tracking (would need a new event at ZIP-member assembly).
- Subtree (parent-includes-children) rollup.
- Hour-of-day / weekday view heatmap (only meaningful with IP logging on).
- CSV/PDF export of analytics.
- Caching / materialized rollups for very large instances.
- Referrer / geo / device analytics (we log neither; would need new capture +
  a privacy decision).

## Deployment impact

None beyond a normal image pull — no migration, no new dependency, no
host-mounted config change. Visitor/views data only appears once an admin
enables IP logging (Settings → General), which is the pre-existing toggle.
