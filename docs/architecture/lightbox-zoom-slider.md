# Lightbox zoom slider (desktop, review mode)

Status: implemented (2026-07-02)

## Problem

On desktop the lightbox has no zoom at all — the photo renders object-contain at fit
scale, and the only way to judge focus/detail is to download the original. Touch devices
got pinch-to-zoom (see `lightbox-pinch-zoom.md`), but a desktop reviewer culling a shoot
has nothing. picdrop solves this with a zoom slider in the bottom toolbar (magnifier icon
+ slider + percentage readout); clients coming from there expect it.

This is a **review tool**, not a presentation flourish: it appears only where reviewing
happens — never in a Showcase lightbox.

## Goals

- picdrop-style zoom control bottom-right of the desktop lightbox: magnifier icon,
  slider, live percentage.
- Drag-to-pan while zoomed; wheel / trackpad-pinch zoom anchored at the cursor.
- Review contexts only: public galleries with review active (`collabMode` — Review mode
  or the client Showcase→Review switch flipped) **and** the admin lightbox
  (`adminGalleryId`), which is the photographer's own review surface.
- Frontend-only. No backend change, no migration, no new dependency.

Non-goals (v1):

- The touch/`compact` path — pinch-to-zoom already covers it and there's no room for a
  slider; the two paths stay mutually exclusive via the existing `compact` gate.
- Zoom on videos / `no_preview` slides (control hidden).
- Double-click-to-zoom — the desktop photo click toggles immersive mode *instantly*;
  detecting a double-click would delay that by ~250 ms for everyone. Slider + wheel
  suffice in v1.
- Fetching originals for zoom (see sharpness section).

## Zoom semantics: what does the percentage mean?

The readout is **relative to the fit scale** (decided over picdrop's original-relative
percentage): 100 % = the photo as it opens (object-contain fit), 400 % = the pinch-zoom
maximum (`MAX_SCALE`). Same range and meaning as the touch zoom, no dependency on the
(nullable) original `Image.width`, and the number never implies an original-pixel
sharpness the preview can't deliver.

- Slider range **100 %–400 %**; opening / navigating always starts at 100 %.
- Zoom state is per photo and transient (identical to the pinch-zoom rules).

**Sharpness ceiling:** the pixels on screen stay the `medium` rendition (1920 / 2560 px,
watermark-proxy-aware via the existing `variantSrc`) — originals are never fetched, so
the watermark is never bypassed and download gating is never sidestepped (the same
invariant pinch-zoom established). Mitigation: on the first zoom past ~1.2× the slide's
`sizes` attribute is bumped (`100vw` → `200vw`), so the browser's srcset re-picks the
largest available preview (2560 px under high-res previews). The alternative (serving
originals) breaks two security invariants — off the table.

## Interaction model

| Input | At fit | Zoomed (> fit) |
|---|---|---|
| Slider drag | zooms in, anchored at the viewport center | adjusts zoom around the viewport center |
| Wheel / trackpad pinch over the photo | zooms in around the cursor | adjusts zoom around the cursor |
| Mouse drag on the photo | — (click = immersive, unchanged) | pans the photo (grab/grabbing cursor), clamped to the photo edges |
| Click (no movement > ~5 px) | toggle immersive (unchanged) | toggle immersive |
| Magnifier icon click | — | back to fit (quick reset) |
| Arrow keys / chevrons | navigate (unchanged) | navigate; zoom resets to fit — **even with the slider focused** (the control preventDefaults ←/→ and `lightbox-keys` exempts range inputs from its editable-target guard; ↑/↓ still step the zoom for keyboard users) |
| Esc | close (unchanged) | close |

- While zoomed, the desktop *touch* swipe handlers (`handleTouchStart` & co. — active on
  non-compact touch screens) stand down, exactly like the mobile dismiss handlers do
  while pinch-zoomed.
- **Annotating while zoomed works.** The zoom persists into annotate mode; wheel and
  slider keep zooming, only the drag-pan stands down (the pen owns the drag —
  `panDisabled`). Coordinates need no special handling: the pen's input normalization
  (`frac()`) uses `getBoundingClientRect`, which reflects the zoom transform, so strokes
  land exactly where drawn; the marks render in layer space and are scaled visually by
  the same transform. Only the note popover counter-scales itself
  (`scale(calc(1 / var(--zoom-scale)))`, written imperatively by the hook onto the zoom
  layer) so the textarea stays 1:1 readable at 4×.
- Immersive mode hides the control with the rest of the chrome; the zoom itself persists.

## Placement & look

The control sits at the **right end of the lightbox bottom toolbar**, on the same row as
the flag/rating actions (picdrop's layout): magnifier icon (also the reset button), a
slim slider (~96 px), and the percentage text, styled from `lightboxTones`. The toolbar
row renders in review contexts even when flags & likes are off, so the control never
jumps around; on video / `no_preview` slides it's absent.

No shadcn Slider is installed; a thin styled native `<input type="range">` keeps it
dependency-free (one small component, `LightboxZoomControl`).

## Implementation shape

The pinch-zoom work already gives us almost everything:

| File | Change |
|---|---|
| `src/lib/pinch-zoom.ts` | Reuse as-is: `fitSize`, `clampPan`, `zoomAround`, `settle` are pure center-origin transform math, not touch-specific. Add a tiny percent↔scale mapping helper (unit-tested). |
| `src/hooks/useZoomSlider.ts` (new) | Desktop zoom hook: owns `{scale, tx, ty}` in refs, writes `transform: translate() scale()` **imperatively** to the existing zoom layer (`zoomLayerRef` target in `slideContent` — same node pinch-zoom drives on mobile; the `compact` gate makes the two mutually exclusive). Wheel listener (non-passive, `preventDefault`), pointer-drag pan, reset on index change / annotate / unmount. Exposes `percent` + `setPercent` as React state for the slider UI only. |
| `src/components/gallery/LightboxZoomControl.tsx` (new) | The pill: magnifier + range input + percent label, tones-aware. |
| `src/components/gallery/Lightbox.tsx` | Mount hook + control when `!compact && (collabMode || adminGalleryId)` and the slide is a photo with a preview; suppress click-to-immersive after a pan-drag; bump `sizes` while zoomed; touch-swipe handlers stand down while zoomed. |

Annotation marks scale with the photo for free — the zoom layer already wraps photo +
`AnnotationLayer`, and that layer measures layout offsets (not `getBoundingClientRect`)
precisely so a transform doesn't double-scale it. Flag/star badges stay outside the
layer (unscaled chrome), as on mobile.

i18n: two or three keys under `gallery.lightbox` (`zoom`, `zoomReset` aria/labels);
`en.json` is the source of truth, German lands via Weblate. Validate with
`node scripts/validate-i18n.mjs`.

## Configuration (Settings → Gallery defaults → Viewing)

Instance-wide, on `app_settings` (migration 0044), surfaced in the public gallery payload
next to `lightbox_backdrop` and in the admin settings for the admin lightbox:

- `lightbox_zoom_enabled` (default on) — hides the control entirely when off (wheel zoom
  included; the whole desktop zoom hook disengages). Mobile pinch-zoom is unaffected.
- `lightbox_zoom_max` (default `"400"`) — the slider/wheel ceiling: `"200"`, `"300"`,
  `"400"` (fit-relative percent), or `"original"` = the photo's 1:1 original pixel size,
  derived per photo from `image.width / fit width` (can exceed 400 % for large originals,
  and collapses to nothing for photos smaller than their fit box — the control hides
  then). The readout stays fit-relative; the pixels stay the `medium` rendition either
  way (originals are never fetched).

## Testing

- Vitest: percent↔scale mapping (fit% floor, 100 % ceiling, null-width fallback) beside
  the existing `pinch-zoom.test.ts`.
- Manual: review gallery (slider appears), showcase gallery (absent), client-switch
  gallery (appears after flipping to Review), admin lightbox (appears); wheel/drag/pan
  clamping; annotate resets; watermarked gallery zooms the watermarked rendition; light
  backdrops render the pill legibly.
- E2E: none needed — existing smoke covers lightbox open/navigate; the control is pure
  client-side view state.

## Deployment impact

Migration 0044 (two `app_settings` columns) — applied automatically by the backend's
`start.sh` (`alembic upgrade head`) on container start, so a normal image pull &
`up -d` delivers it. No nginx/compose change.
