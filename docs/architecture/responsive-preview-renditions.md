# Responsive preview renditions (srcset for the lightbox)

Status: implemented (2026-06-16)

> Implementation note: shipped with a single `small_url` field on `ImageResponse` (mirroring the
> existing `thumb_url`/`medium_url` pattern) rather than a `renditions` array — lower churn, no
> threading caps through every serializer caller, and consistent with the codebase. Width descriptors
> are computed client-side in `previewSrcSet(img, highRes)`, which now takes the mode so the caps are
> correct in **both** res modes (the prior latent gap).

Cut image load-time — especially the lightbox on mobile — by serving a right-sized rendition
per device instead of always shipping the full `medium` file. This is "Option 1" from the
load-time discussion: responsive renditions + `srcset`, **not** a CDN and **not** embedded LQIP.

## Problem

The grid already uses responsive `srcset` (`previewSrcSet` in `lib/gridLayout.ts`, gated on the
`high_res_previews` setting). The **lightbox does not** — it loads `medium_url` directly:

```ts
src={ watermarkEnabled && shareToken ? `…/medium` : (medium_url ?? thumb_url) }
```

`medium` is **2560px** (or 1920px in low-res mode). On a phone (~390 CSS px × DPR 3 ≈ 1170 device
px) that's roughly **4× more pixels than needed**. And there's a big gap in the ladder — `thumb`
(800) → `medium` (2560) with nothing between — so even adding `srcset` over the existing two tiers
wouldn't help: 800 is too small for a full-screen view, so the browser would still pick 2560.

The fix is one intermediate tier plus `srcset` on the lightbox.

## Design

### Rendition ladder

Add a `small` tier between `thumb` and `medium`. Caps stay gated by `high_res_previews`:

| variant | low-res (toggle off) | high-res (toggle on) | used by |
|---|---|---|---|
| `thumb`  | 300 | 800  | grid tiles |
| `small`  | **1024** | **1280** | lightbox on phones/tablets; grid retina |
| `medium` | 1920 | 2560 | lightbox on desktop / hi-DPI |

`small` (1280) sits just above a typical phone's device-px need, so the browser picks it instead
of `medium` → ~half to ~quarter the bytes on mobile. Desktop/4K still gets `medium`.

**No DB migration.** Renditions are files in `{gallery}/{variant}/`; the `small` rendition is a new
subdirectory. Each rendition's intrinsic pixel width is computed from the already-stored
`width`/`height`, so nothing new is persisted.

### Backend

- **`app/tasks/image_processing.py`** — `preview_targets(high_res)` gains the `small` entry; `process_image`
  already iterates implicitly by calling `_save_resized` per target, so `small` is generated at upload
  alongside thumb/medium.
- **`app/tasks/preview_upgrade.py`** — `_sync_previews` currently only *resizes existing* rendition
  files (`if not os.path.exists(path): continue`). Change it to **generate a missing rendition** from
  the original instead of skipping, so existing images get their `small` file on the next startup
  (idempotent; cheap when present). This is the backfill — no separate migration job.
- **`app/services/image_service.py`** (`_image_to_response`) — add `small_url` alongside
  `thumb_url`/`medium_url` (static rendition path when un-watermarked, the `…/small` proxy route when
  watermarked). `thumb_url`/`medium_url` stay (back-compat + the blur-up placeholder + `src` fallback).
  Width descriptors are computed client-side from `width`/`height` + the per-mode caps (see Frontend).
- **`app/routers/public.py`** — the watermark proxy is already variant-generic
  (`_watermarked_variant(variant, …)`); add a `…/images/{id}/small` route mirroring the thumb/medium
  ones. The on-the-fly composite caches to `small-wm/` automatically.

### Frontend

- **`lib/gridLayout.ts`** — `previewSrcSet(img, highRes)` now takes the mode, picks the matching cap
  set (`PREVIEW_CAPS.low` / `.high`), includes the new `small` tier, and drops tiers that don't end up
  wider than the previous (small originals). Correct in both res modes.
- **`components/gallery/Lightbox.tsx`** — the current photo + the peek-neighbor `<img>`s get
  `srcSet={previewSrcSet(img, highRes)}` + `sizes="100vw"` (keep `src={mediumSrc(image)}` as fallback).
  New `highRes` prop, passed from `gallery.high_res_previews` (public) / `adminSettings.high_res_previews`
  (admin). The neighbor **preloader** now warms the `small` rendition (the tier mobile actually shows —
  lighter, and mobile is where preload matters; desktop is fast regardless).
- **Grid** (`PhotoGrid` / `admin-grid-tile`) — already wired for `srcset`; pass `highRes` to
  `previewSrcSet`. Watermarked galleries use proxy URLs (now incl. `…/small`), same as before.

## Cost / trade-offs

- **+1 rendition file per image** (~150–400 KB each). For a multi-thousand-image install this is real
  added disk; it's the price of the mobile bandwidth/latency win. Noted in the README storage section.
- Upload CPU: one extra Pillow resize per image (cheap, already doing two).
- No new dependency, no CDN, no schema change. App stays slim; `srcset`/`sizes` are native HTML.

## Out of scope

- CDN / edge caching (separate infra decision; deliberately not now).
- Embedded LQIP / BlurHash (assessed — not worth the payload/migration for our flow).
- AVIF/WebP output (current renditions are progressive JPEG; a format change is a separate study).
- Per-viewport `medium` for the download/original (downloads stay the true original).
