# Gallery Creation Dialog, Default Mode Presets & Settings Navigation

Status: **approved & implemented** (2026-06-12)

Three related changes that streamline gallery creation and instance settings:

1. **Create New Gallery becomes a simple popup** — title + mode picker (Collaboration /
   Presentation), nothing else. All other configuration happens later in the gallery's
   settings modal.
2. **Default gallery presets per mode** — instance-level defaults for the look & behaviour
   settings, one preset per mode, applied at gallery creation.
3. **Settings page restructure** — `/admin/settings` splits into sections with its own
   sidebar navigation (same sidebar-swap mechanism as the gallery detail view), including a
   back-to-galleries link.

---

## 1. Data model (migration `0009`)

Two new nullable JSON (TEXT) columns on `app_settings`:

| Column | Type | Meaning |
|---|---|---|
| `preset_presentation` | TEXT (JSON), nullable | Default look & behaviour for new presentation-mode galleries |
| `preset_collaboration` | TEXT (JSON), nullable | Default look & behaviour for new collaboration-mode galleries |

`NULL` (or an absent key inside the JSON) means "use the model's built-in default" —
existing behaviour is unchanged until the admin edits a preset.

**Why JSON, not wide columns:** presets are only ever read and written as a whole blob
(load → merge at creation; edit form → save). Nothing queries or filters by individual
preset fields, so the explicit-column benefit doesn't apply here, and we avoid a 14-column
migration plus a second copy of every future gallery-settings column. Shape is enforced at
the API layer by a Pydantic schema (below). The galleries table keeps its explicit columns —
this changes nothing about per-gallery storage.

### Preset shape (Pydantic `GalleryPreset`, all fields optional)

Exactly the existing "look & behaviour, not identity" set already defined by
`_CASCADE_FIELDS` in `gallery_service.py`, minus `expires_at` (an instance default for
expiry makes no sense), and minus the not-yet-built features (`scribbles_enabled`,
`sets_enabled`, `client_upload_enabled`, `show_iptc`, `contact_sheet_enabled`) which stay
at model defaults until those features exist:

- Presentation: `layout`, `opener_font`, `opener_font_size`, `preview_size`,
  `preview_spacing`, `preview_corners`, `bg_brightness`, `bg_dimmed_color`
- Behaviour: `downloads_enabled`, `enable_team_voting`, `color_flags_enabled`,
  `likes_enabled`, `comments_enabled`, `show_filename`, `show_exif`

Unknown keys are rejected (`extra="forbid"`) so stored JSON can never drift from the schema.

---

## 2. API changes

### Admin settings (`/api/admin/settings`)

- `AppSettingsResponse` gains `preset_presentation: GalleryPreset | None` and
  `preset_collaboration: GalleryPreset | None`.
- `AppSettingsUpdate` gains the same two fields. PATCH semantics mirror `public_base_url`:
  omitted → unchanged; an object → validated and stored (full replace, not deep merge);
  explicit `null` → cleared back to built-in defaults.

No new endpoints — presets are app settings.

### Gallery creation (`POST /api/galleries`)

`GalleryCreate` is unchanged (`name`, `mode`, `parent_id`, … all still accepted).
`create_gallery` in `gallery_service.py` gains a defaults-resolution step, applied only to
fields the request did not set explicitly (checked via `model_fields_set`):

1. **Sub-gallery** (`parent_id` set): copy the parent's current `_CASCADE_FIELDS` values
   and the parent's `mode`. This matches the existing `apply_to_subgalleries` cascade
   semantics and makes the sub-gallery dialog's "inherits the parent's look & behaviour"
   hint literally true.
2. **Top-level gallery**: load the preset JSON for the chosen mode (default mode stays
   `presentation`) and merge it into the create kwargs.

The merge is an explicit field-by-field mapping (no `**json` splatting), so a stale or
hand-edited preset value can never reach a column it shouldn't.

---

## 3. Frontend

### `CreateGalleryDialog` (new; replaces `GalleryForm` for creation)

Mirrors our existing `CreateSubGalleryDialog`:

- "Please enter a title for your new gallery." + title input
- "Choose how you want clients to see it:" + two selectable cards:
  - **Collaboration Mode** — `MessagesSquare` icon, "Share work & collect feedback"
  - **Presentation Mode** — `Sun` icon, "Beautiful customizable galleries"
  - default selection: Presentation
- "You can always change your mind later." hint
- Buttons: Cancel · Create · **Create & Open** (primary; Enter key triggers it).
  Create stays put, Create & Open navigates into the new gallery.
- Sends `{ name, mode }` only — everything else comes from the preset server-side.

Used by the overview page button and the sidebar tree's "+ New". `GalleryForm` then has no
remaining callers and is deleted (password/description/etc. all live in
`GallerySettingsModal` already). `CreateSubGalleryDialog`'s hint text is updated to say the
sub-gallery starts from the parent's look & behaviour.

### Settings restructure (`/admin/settings/*`)

Sub-routes, one page component per section:

| Route | Content |
|---|---|
| `/admin/settings/general` | Instance name, public base URL |
| `/admin/settings/appearance` | Admin theme, accent color, logo |
| `/admin/settings/gallery-defaults` | The two mode presets |

`/admin/settings` redirects to `general`. The admin layout's sidebar-swap (introduced for
the gallery detail view) gets a second case: on `/admin/settings*` the gallery tree is
replaced by an "‹ All Galleries" back link plus a section nav (Settings header + three
links, active state by pathname). The Settings/Sign-out footer stays.

### Gallery-defaults section UI

A "Default Gallery Presets" card: one row per mode (icon, name, short
description, **Edit** button). Edit opens a modal with the same controls as the gallery
settings modal's Presentation tab + the collaboration feature toggles.

To avoid duplicating those forms, the field groups are factored out of
`GallerySettingsModal.tsx` into shared controlled components
(`PresentationFields`, `CollaborationFields` — value/onChange props, no data fetching);
`GallerySettingsModal` and the new `PresetEditorModal` both consume them. The preset editor
loads the stored preset merged over built-in defaults, saves via
`PATCH /api/admin/settings`, and offers "Reset to built-in defaults" (sends `null`).

---

## Implementation roadmap

1. **Backend**: migration `0009`; `AppSettings` model + repo; `GalleryPreset` schema;
   settings router GET/PATCH; `create_gallery` defaults resolution (sub-gallery inherit +
   preset merge).
2. **API client/types**: `GalleryPreset`, extended `AppSettings`/`AppSettingsUpdate`.
3. **Create dialogs**: `CreateGalleryDialog`; wire into overview + tree; delete
   `GalleryForm`; update sub-gallery hint text.
4. **Settings**: sub-routes + redirect; sidebar section nav in admin layout; factor shared
   field components out of `GallerySettingsModal`; preset editor modal.
5. **Verify**: `alembic upgrade head` on dev DB; Playwright: create flows in both modes,
   preset round-trip (edit preset → create gallery → check applied), sub-gallery
   inheritance, settings nav; `tsc` + eslint.

## Decisions to confirm

1. **JSON columns** for presets (vs. mirroring all fields as explicit columns) — §1.
2. **Sub-galleries copy the parent's settings at creation** (instead of applying the mode
   preset) — §2. This could be exposed later as an "Inherit Gallery Settings" toggle; we'd make it
   the only behaviour for now.
3. **Preset scope excludes coming-soon features** until they ship — §1.
4. **Settings sections**: General / Appearance / Gallery Defaults — §3.
