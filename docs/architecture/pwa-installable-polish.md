# Installable PWA polish (manifest + icons, no service worker)

Status: implemented (2026-06-16); icon delivery superseded by
[`branding-aware-favicon.md`](branding-aware-favicon.md) the same day — the static
PNGs / `app/favicon.ico` / `generate-icons.py` described below were replaced by
backend-rendered, branding-derived icons under `/api/branding/`. The manifest /
`appleWebApp` / `themeColor` wiring here still stands.

Makes ContactSheet a polished **installable** web app — a proper home-screen/Dock icon, app name,
status-bar theme color, and standalone window — **without** a service worker or offline support.
Scope is deliberately the "install polish" tier; offline caching is a non-goal (image-heavy,
server-/realtime-backed app — bad ROI, see the discussion in the mobile-responsive work). The app is
already mobile-responsive (`mobile-responsive.md`); this fills the remaining gap: there was **no
manifest, no icons, not even a favicon**.

## What ships

- **Web app manifest** — `frontend/src/app/manifest.ts` (Next App Router `MetadataRoute.Manifest`,
  served at `/manifest.webmanifest`): `name` "ContactSheet", `short_name` "ContactSheet",
  `description`, `start_url: "/"`, `display: "standalone"`, `background_color` + `theme_color`
  `#0a0a0b` (the app's near-black public tone), `icons` (192 + 512 "any", 512 "maskable").
- **Icons** — generated as static PNGs in `frontend/public/` by
  `frontend/scripts/generate-icons.py` (Pillow, committed so the build never depends on it):
  - `icon-192.png`, `icon-512.png` — rounded-square "any" icons.
  - `icon-maskable-512.png` — full-bleed (no rounding) with extra safe padding so Android's mask
    can't crop the motif.
  - `apple-touch-icon.png` (180×180) — full-bleed square, **no transparency / no rounding** (iOS
    applies its own mask + background).
  - `favicon.ico` (16/32/48 multi-size) — the previously-missing tab icon.
- **Metadata** (`frontend/src/app/layout.tsx`):
  - `export const viewport: Viewport` with `themeColor: "#0a0a0b"` (Next 15 splits viewport out of
    `metadata`).
  - `metadata.manifest = "/manifest.webmanifest"`, `metadata.icons` (icon + apple-touch),
    `metadata.appleWebApp` (`{ capable: true, statusBarStyle: "black-translucent", title:
    "ContactSheet" }`), and `metadata.applicationName`.

## Icon design

On-name **contact-sheet motif**: a dark rounded square holding a 3×3 grid of warm off-white photo
frames, with the **top-left frame in amber** (`#f59e0b`) as a focal accent (a nod to a
selected/flagged frame). Drawn vectorially in the generator so it stays crisp at every target size;
chunky proportions keep it legible down to the favicon. **Instance-accent-independent** by design —
the per-instance `accent_color` can be anything (here it's `#000000`), so the shipped default icon
uses its own fixed palette rather than reading branding settings.

Re-run after a design tweak: `backend/.venv/bin/python frontend/scripts/generate-icons.py`
(the script writes straight into `frontend/public/`). Pillow ≥ 8.2 (`rounded_rectangle`).

## Non-goals

- **Service worker / offline / install prompt UI** — not built. "Add to Home Screen" is the
  browser's native affordance; we only make its result look right.
- Per-instance branded icons (generating the manifest icon from the uploaded logo / accent). Possible
  later, but the manifest is a static route today; keeping the default fixed avoids a build-time
  dependency on DB branding.
- Push notifications (the app already has its own Apprise-based notification channel).

## Verification

Build, then load `/manifest.webmanifest` (valid JSON, icons resolve 200), confirm `<link
rel="manifest">`, `<meta name="theme-color">`, and apple-touch-icon `<link>` render in the document
head, and that the icon files exist and are non-empty PNGs/ICO.
