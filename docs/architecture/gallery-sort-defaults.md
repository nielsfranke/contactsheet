<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Gallery sort defaults (sticky in-gallery sort + overview by date)

**Status:** implemented (2026-06-16)

## Goals

1. **In-gallery photo sort** opens on a sensible default instead of always
   `Manual`. Behaviour: **sticky** — the sort you pick is remembered and reused
   for the next gallery until you change it again, **seeded to Capture Date**.
   Applies to **both** the admin in-gallery view and the client gallery.
2. **All-galleries overview** (`/admin/galleries`) sorts **by date, newest
   first**, by default.

## Current state

- Both the admin (`useGalleryDetail`) and client (`useGalleryView`) photo views
  hard-init `arrange.sortKey: "manual"`, `sortAsc: true`. The sort keys
  (`manual / filename / date / captured`) and comparators already exist
  (`lib/image-sort.ts`); only the **default** and its **persistence** are missing.
- The overview's `created` sort option is **mislabelled "date"**: `sortGalleries`
  in `lib/gallery-sort.ts` returns the raw API order (`sort_order`) for `created`,
  not a `created_at` comparison. Default is `overview_sort="created"`,
  `overview_sort_dir="asc"`.

## Design

### One instance-level default-sort setting (drives both surfaces)

Add to `app_settings` (**migration 0033**):

- `gallery_sort` — `String(12)`, default `"captured"` (one of
  `manual/filename/date/captured`).
- `gallery_sort_dir` — `String(4)`, default `"asc"` (`asc`/`desc`).

This single value is the **default sort** for galleries. Wiring:

- **Admin in-gallery view** seeds its initial `arrange` from this setting **and
  writes back** whenever the sort changes → that's the "sticky / remembers last"
  behaviour. Stored via the existing `GET`/`PATCH /api/admin/settings`
  (`AppSettingsUpdate.gallery_sort` / `gallery_sort_dir`, mirroring how
  `overview_sort` already works). Debounced like other admin-settings autosaves.
- **Client gallery view** seeds its initial sort from the **same value**,
  exposed read-only on the public response as `default_sort` / `default_sort_dir`
  (added to `GalleryPublicResponse` in `get_public_gallery`, alongside the
  existing `accent_color` / `footer`). The client can still re-sort locally for
  their session, but never writes back.

**Coupling note (intended):** because one setting feeds both, if the
photographer changes their in-gallery sort to e.g. "File Name", new client
galleries also default to "File Name". With the default untouched, both stay
Capture Date. This matches the chosen "admin + client" scope; a future split
into two settings is possible if the coupling proves wrong.

Only the **sort key + direction** are sticky — filter / grouping stay per-view
session state (not persisted).

### Overview: real date sort, newest first

- Fix `sortGalleries` so `created` orders by **`created_at`** (already on
  `GalleryResponse` + `lib/types.ts`) instead of falling through to API order.
  Pure frontend change.
- Default to **newest first**: bump the `overview_sort_dir` server default to
  `"desc"`, and in migration 0033 update the existing singleton row from the old
  default (`asc` → `desc`) so this single-admin instance picks it up. `overview_sort`
  stays `"created"`. (Direction remains user-changeable in Settings → Workspace.)

## Frontend touch points

| File | Change |
|---|---|
| `app/admin/galleries/[id]/useGalleryDetail.tsx` | seed `arrange` sort from `["admin-settings"]`; write `gallery_sort`/`gallery_sort_dir` on change (sticky) |
| `components/gallery/useGalleryView.ts` | seed initial sort from `gallery.default_sort` / `default_sort_dir` |
| `lib/gallery-sort.ts` | `created` → real `created_at` comparator |
| `lib/types.ts` | `default_sort` / `default_sort_dir` on the public gallery type; `gallery_sort` / `gallery_sort_dir` on `AppSettings` |
| `lib/api.ts` | pass-through (no new endpoint — rides admin-settings + public gallery) |

## Backend touch points

| File | Change |
|---|---|
| `models/app_settings.py` | `gallery_sort`, `gallery_sort_dir` cols; `overview_sort_dir` default → `desc` |
| `alembic/versions/0033_*.py` | add cols + flip existing `overview_sort_dir` |
| `schemas/settings.py` | `gallery_sort` / `gallery_sort_dir` on `AppSettingsUpdate` + `AppSettingsResponse` |
| `schemas/gallery.py` | `default_sort` / `default_sort_dir` on `GalleryPublicResponse` |
| `routers/admin_settings.py` | persist the two new scalars (existing PATCH loop) |
| `services/gallery_service.py` | populate `default_sort` / `default_sort_dir` on the public response |

## Out of scope

- Per-gallery (rather than instance-wide) default sort.
- Making filter / grouping sticky.
- A separate admin-vs-client default (single coupled setting for now).

No new dependency. One migration (0033).
