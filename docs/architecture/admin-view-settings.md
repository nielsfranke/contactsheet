# Admin View Settings (Admin Gallery Grid & Gallery Overview)

Status: **approved & implemented** (2026-06-12)

Two new instance-level settings that let the admin control how their *own* admin views look,
independently of what clients see:

1. **Admin gallery view** — the photo grid inside `/admin/galleries/[id]`. Today it is strictly
   WYSIWYG: it reads each gallery's client-facing `layout` + `preview_size/spacing/corners`, so the
   admin can't choose a denser working view without changing what the client sees. We keep "mirror
   the client" as the default and add an instance-wide override (size / spacing / corners / layout).
2. **Gallery overview** — the gallery-cover grid on `/admin/galleries`. Today it is fully hardcoded
   (square covers, `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, fixed gap, list order
   from the API). We add instance-wide controls for thumbnail size, cover shape, spacing, and sort.

Both are admin-only preferences — they never affect the public gallery — so they live on
`app_settings` alongside `admin_theme` / `high_res_previews`, and are edited in a new
**Settings → Admin View** section.

---

## 1. Data model (migration `0014`)

Five new columns on `app_settings`, all `NOT NULL` with server defaults that reproduce today's
behaviour (so existing installs are visually unchanged after upgrade):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `admin_grid_mode` | String(10) | `"mirror"` | `"mirror"` = WYSIWYG (current behaviour) / `"custom"` = use the override below |
| `admin_grid_view` | JSON, nullable | `NULL` | Override look for the admin gallery grid; shape = `AdminGridView` (below). `NULL` ⇒ built-in defaults |
| `overview_size` | String(10) | `"medium"` | Gallery-overview tile size (`small`/`medium`/`large`) → column count |
| `overview_shape` | String(10) | `"square"` | `"square"` (current) / `"aspect"` (respect cover aspect ratio) |
| `overview_spacing` | String(10) | `"medium"` | Gap between overview tiles (`small`/`medium`/`large`) |
| `overview_sort` | String(20) | `"created"` | `"created"` (current API order) / `"name"` / `"photos"` |

**Why a JSON blob for the admin grid override but explicit columns for the overview:**
the admin-grid override mirrors the existing `GalleryPreset` pattern — a small bag of look fields
read/written as a whole, never queried by field — so JSON keeps it consistent and avoids four more
columns. The overview controls are flat scalars the page reads individually, so plain string columns
are simpler there. `admin_grid_mode` stays an explicit column (not inside the JSON) so "mirror vs
custom" is a clear top-level toggle independent of whether the override has been customised yet.

### `AdminGridView` shape (Pydantic, all fields optional → built-in default)

Reuses the existing gallery look types exactly:

| Field | Type | Built-in default |
|---|---|---|
| `layout` | `LayoutType` (`grid`/`masonry`/`list`) | `grid` |
| `preview_size` | `SizeType` (`small`/`medium`/`large`) | `medium` |
| `preview_spacing` | `SizeType` | `medium` |
| `preview_corners` | `CornersType` (`round`/`square`) | `round` |

`model_config = {"extra": "forbid"}`, same as `GalleryPreset`.

---

## 2. Backend

- **Model** (`app/models/app_settings.py`): add the five columns above.
- **Migration** `0014_admin_view_settings`: `add_column` for each with the server defaults; no
  data backfill needed (defaults reproduce current behaviour).
- **Schema** (`app/schemas/settings.py`):
  - new `AdminGridView(BaseModel)` (the four optional look fields, `extra="forbid"`).
  - `AppSettingsUpdate`: add `admin_grid_mode: Literal["mirror","custom"] | None`,
    `admin_grid_view: AdminGridView | None` (object replaces / explicit `null` resets, via
    `model_fields_set`, exactly like the presets), and `overview_size/shape/spacing/sort` as
    optional validated `Literal`s.
  - `AppSettingsResponse`: surface all five.
- **Router** (`app/routers/admin_settings.py`): extend `_to_response` and the `update_settings`
  field-copy loop. The `admin_grid_view` preset follows the identical "object → `model_dump(
  exclude_none=True)`, explicit null → `None`" handling already used for `preset_*`. No new
  endpoints — everything rides the existing `GET`/`PATCH /api/admin/settings`.

No service/repository changes — `settings_repo.update(**updates)` already takes arbitrary columns.

---

## 3. Frontend

### Types & API
- `src/lib/types.ts`: add `AdminGridView`, extend `AppSettings` + `AppSettingsUpdate` with the new
  fields. `api.adminSettings.*` is generic over the update body — no client change beyond types.

### Admin gallery grid (`/admin/galleries/[id]`)
- The detail page already builds `layout` + `presentation` from `gallery.*`. Add an
  `["admin-settings"]` query (same key the settings pages use, so it's cached) and, when
  `admin_grid_mode === "custom"`, source `layout`/`presentation` from `admin_grid_view` (falling
  back to the built-in defaults per field) instead of the gallery. `AdminImageGrid` itself is
  unchanged — it already accepts `layout` + `presentation` props. The comment on the grid changes
  from "mirrors the client" to note the override.
- **Important:** this only changes the admin grid. The header strip, captions, flag grouping, and
  every public component still read from the gallery. The client gallery is untouched.

### Gallery overview (`/admin/galleries`)
- Query `["admin-settings"]`; drive the grid from the new fields:
  - `overview_size` → column classes (reuse the `GRID_COLS` map from `gridLayout.ts`).
  - `overview_spacing` → gap (reuse `GAP`).
  - `overview_shape` → `aspect-square` (current) vs `aspect-[3/2]` + `object-cover`.
  - `overview_sort` → client-side sort of the already-loaded list (`created` keeps API order;
    `name` alphabetical; `photos` by `image_count` desc). Sub-gallery search behaviour unchanged.

### Settings UI — new "Admin View" section
- New route `src/app/admin/settings/admin-view/page.tsx` and a nav entry in `app/admin/layout.tsx`
  (after Appearance, e.g. icon `LayoutGrid`).
- Two cards:
  1. **Gallery photo grid** — a "Match client view / Custom" segmented toggle (`admin_grid_mode`);
     when Custom, show size / spacing / corners / layout controls. Reuse the existing
     `Segmented`/`Row` primitives from `gallery-settings-fields.tsx` so it matches the presentation
     controls already in the gallery settings modal and preset editor.
  2. **Gallery overview** — size / shape / spacing / sort controls, same primitives. A small live
     preview (a few placeholder tiles) is optional/nice-to-have, not required for v1.
- Saving calls the existing `api.adminSettings.update(...)` and invalidates `["admin-settings"]`.

---

## 4. CLAUDE.md / docs updates (on implementation)
- Add migration `0014` to the migrations list.
- Note the new `Settings → Admin View` section under the settings-nav description.
- Reference this doc.

## 5. Out of scope
- Per-gallery admin-view overrides (we chose instance-wide).
- Any change to public/client rendering.
- Persisting overview sort/filter per session beyond the instance default.
