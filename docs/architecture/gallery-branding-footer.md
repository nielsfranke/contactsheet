# Personal Branding / Contact Footer

Status: **approved & implemented** (2026-06-12)

## Update (2026-06-13) — unified editor + handle-based social fields

The admin editor was simplified after the initial build:

- **One box instead of two.** The separate "fields" and "Icon order" cards were merged. Business
  name + Website are plain inputs on top; the eight contact/social rows below are now each a single
  **draggable row that contains its own inline input** (drag handle + icon + handle field). The
  standalone reorder list is gone. `icon_order` storage/semantics are unchanged.
- **Enter the handle, not the URL.** Social fields now take a bare handle (e.g. `yourhandle`); the
  full URL is built at render. Each row shows a non-editable prefix (`instagram.com/`,
  `tiktok.com/@`, `linkedin.com/in/`, …) so the user types only the handle.
- **No backend/schema/migration change.** Fields still store plain strings. The platform metadata +
  URL building live in `GalleryFooter.tsx` (`SOCIAL_META`, `socialUrl`, exported `socialHandle`).
  `socialUrl` is **backward compatible**: a stored full URL (or domain) is used as-is, a bare handle
  is expanded via the platform base; `socialHandle` strips a legacy URL back to a handle for editing.

The notes below describe the original design; section 5's "drag-ordering out of scope" and the
"full URL for socials" form note are superseded by the above.

A global, instance-level branding footer that appears at the bottom of every public gallery —
business name, website link, and a row of accent-colored contact/social icons — so client
deliveries feel like a finished, branded product.

Reference look (attached): centered **business name** (bold), a **website link** below it, then a
row of round, accent-filled circles with white glyphs (email, Instagram, phone, …).

Decisions (confirmed):
- **Link set:** Business name + website (always), plus toggleable Email, Phone, Instagram,
  Facebook, X/Twitter, TikTok, YouTube, LinkedIn. Only filled-in links render.
- **Scope:** Global only — one instance footer with a single on/off toggle; shows on every public
  gallery (presentation *and* collaboration). No per-gallery override.
- **Icon style:** Filled circles in the instance **accent color**, white glyph inside.

---

## 1. Data model (migration `0015`)

Two new columns on `app_settings`, mirroring the `admin_grid_mode` + `admin_grid_view` pattern
(explicit boolean toggle + JSON content blob):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `footer_enabled` | Boolean, NOT NULL | `0` (false) | Master on/off for the public footer |
| `footer` | JSON, nullable | `NULL` | Footer content; shape = `FooterSettings` below. `NULL` ⇒ no content set |

**Why a JSON blob:** the footer is a ~10-field bag read/written as a whole (load the form → save the
form; render once per gallery). Nothing queries by individual field, so JSON avoids a 10-column
migration and matches the existing preset / admin-grid-override precedent. Shape is enforced at the
API layer by Pydantic.

### `FooterSettings` shape (Pydantic, all fields optional)

| Field | Type | Rendered as |
|---|---|---|
| `business_name` | str | Bold heading |
| `website_url` | str | Text link (scheme prepended at render if missing) |
| `email` | str | `mailto:` circle |
| `phone` | str | `tel:` circle (non-digits stripped for the `tel:` href) |
| `instagram` | str (URL) | circle → href |
| `facebook` | str (URL) | circle → href |
| `x` | str (URL) | circle → href (X / Twitter) |
| `tiktok` | str (URL) | circle → href |
| `youtube` | str (URL) | circle → href |
| `linkedin` | str (URL) | circle → href |

`model_config = {"extra": "forbid"}`. Validation is intentionally light (strip + max length per
field; `email` must contain `@`); URLs are stored as entered and normalized at render
(`https://` prepended when no scheme). Empty strings are treated as unset (dropped via
`exclude_none`-style filtering on save).

---

## 2. Backend

- **Model** (`app/models/app_settings.py`): add `footer_enabled` (Boolean) + `footer` (JSON).
- **Migration** `0015_branding_footer`: `add_column` both, `footer_enabled` server default `"0"`.
- **Schema:**
  - new `FooterSettings(BaseModel)` (fields above, `extra="forbid"`) — defined in
    `app/schemas/gallery.py` (not `settings.py`) so `GalleryPublicResponse` can embed it without a
    circular import; `schemas.settings` imports it from there.
  - `AppSettingsUpdate` (`app/schemas/settings.py`): add `footer_enabled: bool | None` and
    `footer: FooterSettings | None`
    (object replaces / explicit null clears, via `model_fields_set` — same handling as the presets;
    blank strings stripped to `None` so they don't render as empty circles).
  - `AppSettingsResponse`: surface `footer_enabled: bool` and `footer: FooterSettings | None`.
- **Router** (`app/routers/admin_settings.py`): extend `_to_response` and the update loop
  (`footer_enabled` scalar; `footer` joins the existing JSON-blob loop alongside the presets and
  `admin_grid_view`).
- **Public exposure** — the footer is global but rides the already-loaded public gallery response
  (no new endpoint, no extra request):
  - `app/schemas/gallery.py` `GalleryPublicResponse`: add `accent_color: str` and
    `footer: FooterSettings | None`.
  - `app/services/gallery_service.py` `get_public_gallery`: set `accent_color` from settings, and
    `footer` = the stored content **only when `footer_enabled`** (else `None`).

No repository changes — `settings_repo.update(**updates)` already accepts arbitrary columns.

---

## 3. Frontend

### Types & API
- `src/lib/types.ts`: add `FooterSettings`; extend `AppSettings` (`footer_enabled`, `footer`),
  `AppSettingsUpdate`, and `GalleryPublicResponse` (`accent_color`, `footer`).

### New component — `src/components/gallery/GalleryFooter.tsx`
- Props: `footer: FooterSettings`, `accent: string`, `bright: boolean`.
- Renders: centered `business_name` (bold, gallery foreground color), `website_url` as a muted
  link, then a flex row of circular icon links. Each circle: `style={{ backgroundColor: accent }}`,
  white glyph, ~36px, only rendered for a non-empty field.
- **Icons:** lucide ships only `Mail` and `Phone` in this version (brand icons were removed), so the
  social glyphs are small inline brand SVGs kept in this file (Instagram, Facebook, X, TikTok,
  YouTube, LinkedIn) — single-path monochrome, `fill="currentColor"`/white. Email→`mailto:`,
  Phone→`tel:` (digits only), socials→the stored URL (normalized).
- Text colors follow the existing `bright` (`bg_brightness`) flag already computed in `GalleryView`,
  so the footer reads correctly on light or dark gallery backgrounds.

### Wiring — `GalleryView.tsx`
- At the very bottom of the gallery content (below the photo grid / sub-gallery cards, inside both
  presentation and collaboration layouts), render
  `gallery.footer && <GalleryFooter footer={gallery.footer} accent={gallery.accent_color} bright={bright} />`.
  A top divider/`mt` gives it the spacing seen in the reference.

### Admin settings — new "Footer" section
- New route `src/app/admin/settings/footer/page.tsx` + a nav entry in `app/admin/layout.tsx`
  (after Appearance; icon e.g. `PanelBottom`/`Contact`).
- Form: an **Enable footer** toggle, **Business name** + **Website** inputs, then one labelled input
  per contact/social (email, phone, Instagram, Facebook, X, TikTok, YouTube, LinkedIn) with
  placeholder hints (full URL for socials). A small live preview of the icon row (using the saved
  accent) is nice-to-have, not required for v1. Saves via the existing
  `api.adminSettings.update(...)`, invalidates `["admin-settings"]`. A note points to Appearance for
  the accent color the icons use.

---

## 4. Docs (on implementation)
- Add migration `0015` to the CLAUDE.md migrations list.
- Note the new `Settings → Footer` section and that the public gallery response now carries
  `accent_color` + `footer`.
- Reference this doc.

## 5. Out of scope
- Per-gallery footer overrides / hiding (global only).
- Footer on admin/login pages (public galleries only).
- Logo in the footer (the footer is text + icons; the existing logo stays an admin-surface element).
- Drag-ordering the icons (fixed order: email, phone, Instagram, Facebook, X, TikTok, YouTube,
  LinkedIn — only present ones show).
