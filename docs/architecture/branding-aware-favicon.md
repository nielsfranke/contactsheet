# Branding-aware favicon & app icons

Status: implemented (2026-06-16)

Supersedes the static product icon from `pwa-installable-polish.md`: the favicon / PWA icon is now
**derived from the instance's branding** so clients (who see it on the login screen, the gallery, and
when they bookmark/install a share link) see *the photographer's* mark, not the ContactSheet product
mark. Resolution chain, in order:

1. **Uploaded logo** (`app_settings.logo_filename`) — contain-fit onto the icon square.
2. else **Monogram** — the first letter of `instance_name`, on the `brand_color ?? accent_color`
   background, auto-contrast glyph.
3. else **Contact-sheet default** — the existing product mark (drawn server-side), used on a fresh
   install (name still "ContactSheet", no logo).

The icons become **backend-rendered** (the backend has the DB, the logo file, and Pillow; there is no
public branding endpoint the frontend could build from, and the favicon must work pre-login). The
static PNGs + `app/favicon.ico` + `generate-icons.py` from the previous step are **removed** —
rendering lives in one place.

## Backend

### `app/services/branding_icon.py`
- `signature(s) -> str` — short hash of `(logo_filename, logo mtime, instance_name, accent_color,
  brand_color)`. Drives the ETag and an in-process bytes cache (`dict[(sig, kind, size)] -> bytes`,
  tiny; mirrors the deliberate single-process model of the rate limiter / realtime hub).
- `render(s, kind) -> bytes` — `kind ∈ {favicon, any192, any512, maskable, apple}`. Resolves the
  source via the chain above, then:
  - **logo** → open, `convert("RGBA")`, contain-fit into the square with padding; flattened onto an
    opaque background for `apple`/`favicon` (iOS/ICO dislike alpha).
  - **monogram** → first alnum char of `instance_name`, uppercased, centered via
    `ImageFont.load_default(size≈0.6·S)` (scalable since Pillow 10.1 — already used by the watermark
    text feature, so no font asset is shipped); background `brand_color ?? accent_color`, glyph black
    or white by background luminance. Rounded square for `any`/`favicon`, full-bleed for
    `maskable`/`apple`.
  - **contact-sheet** → the `draw_icon` logic ported from the old `generate-icons.py` (dark rounded
    square, 3×3 frame grid, one amber accent frame).
  - `maskable` adds extra safe padding; `apple` is full-bleed opaque; `favicon` renders a multi-size
    `.ico` (16/32/48).

### `app/routers/branding_icon.py` (public, no auth)
Mounted under `/api/branding/` (rides the existing `/api` dev proxy + prod nginx `/api/` location;
**not** `/branding/`, which is a `StaticFiles` mount and would collide):
- `GET /api/branding/favicon.ico`
- `GET /api/branding/icon-192.png`, `…/icon-512.png`, `…/icon-maskable.png`,
  `…/apple-touch-icon.png`

Each loads the `AppSettings` singleton, computes the signature, honours `If-None-Match` → **304**,
else renders (cache-keyed) and returns with `ETag` + `Cache-Control: public, max-age=300,
must-revalidate`. When branding changes the signature changes → new ETag → browsers refetch (no
manual bust needed). Registered in `main.py` alongside the other routers.

### Manifest (also backend-served)
The web app manifest moved to the backend too — `GET /api/branding/manifest.webmanifest`
(`application/manifest+json`, same ETag/`Cache-Control`) — so its **`theme_color` can derive from the
instance `accent_color`** (`branding_icon.theme_color(s)`: the accent when it's a valid hex, else the
dark `#0a0a0b`). The frontend has no server-side path to the backend (all `api.ts` calls are relative,
browser-only; prod SSR-fetch to the backend is unavailable), so serving the manifest from the backend
is the clean way to make it dynamic — same rationale as the icons. `background_color` stays the dark
splash tone. The HTML `<meta name="theme-color">` (`viewport.themeColor` in `layout.tsx`) stays static
`#0a0a0b` on purpose — it tints the mobile browser chrome over the immersive dark gallery, where dark
is intended; only the installed-app manifest colour follows branding.

## Frontend

- `src/app/layout.tsx` — `metadata.manifest` → `/api/branding/manifest.webmanifest`;
  `metadata.icons.icon` → `/api/branding/favicon.ico` + the two PNGs; `metadata.icons.apple` →
  `/api/branding/apple-touch-icon.png`. `viewport.themeColor` / `appleWebApp` / `applicationName`
  unchanged.
- **Remove** `src/app/manifest.ts`, `src/app/favicon.ico`, `public/icon-192.png`,
  `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-touch-icon.png`, and
  `scripts/generate-icons.py` (their job is now the backend).

## Notes / trade-offs

- **No migration** — reuses the existing branding columns.
- **No new dependency** — Pillow already ships in the backend.
- `theme_color` stays the fixed dark tone (not derived from `accent_color`); making it dynamic is a
  possible later step but the manifest is currently a same-origin static route and the dark chrome is
  intentional. Out of scope here.
- **Single-process cache** is fine (self-hosted, one worker — same rationale as realtime/rate-limit).
  Worst case a stale icon for ≤5 min via `max-age`, and the ETag revalidates anyway.
- Backend must be up for the favicon to resolve — true in every deploy (compose/nginx run both);
  acceptable, and the reason the static fallback is dropped rather than kept.

## Verification

Build; with default branding (`instance_name="ContactSheet"`, no logo) confirm `/api/branding/*`
serve the **contact-sheet** icon. Set `instance_name` to a studio name → favicon becomes the
**monogram** (right letter, accent background, contrast glyph), ETag changes. Upload a logo → favicon
becomes the **logo**. Confirm `If-None-Match` returns 304, and the document head links resolve 200.
