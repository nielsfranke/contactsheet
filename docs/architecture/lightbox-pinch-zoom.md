# Lightbox pinch-to-zoom (iPhone / iPad)

Status: implemented (2026-07-02)

## Problem

The lightbox on touch devices (the `compact` path — `(max-width: 768px), (pointer: coarse)`,
so iPhone **and** iPad) is a native horizontal scroll-snap carousel with
`touch-action: pan-x`. That property is what keeps the swipe gesture native and kills the
iOS swipe flash — but it also disallows *all* zooming: a pinch on a photo does nothing.
Clients on phones and tablets expect to pinch into a photo to judge focus/detail, like in
iOS Photos or any delivery platform.

## Goals

- Pinch-to-zoom, pan-while-zoomed, and double-tap-to-zoom on photos in the touch lightbox.
- Must **not** regress the native scroll-snap swipe (the whole point of the mobile path —
  see the carousel comments in `Lightbox.tsx`): the browser keeps owning the horizontal
  gesture whenever the photo is at fit scale.
- No backend changes, no migration. Frontend-only.

Non-goals (v1):

- Desktop trackpad/wheel zoom (desktop path unchanged; can follow later).
- Zoom on videos or `no_preview` slides.
- Panning past the photo edge to navigate to the neighbor while zoomed (iOS Photos does
  this; v1 clamps instead — zoom out to swipe).

## Gesture model

Matches iOS Photos / PhotoSwipe conventions:

| Gesture | At fit (scale = 1) | Zoomed (scale > 1) |
|---|---|---|
| One-finger horizontal drag | native scroll-snap → prev/next | pans the photo (JS, clamped) |
| One-finger vertical drag | swipe-down dismiss (unchanged) | pans the photo |
| Two-finger pinch | zooms in around the pinch midpoint | adjusts zoom around midpoint |
| Double-tap | zoom to ~2.5× at the tap point | back to fit |
| Single tap | toggle immersive (unchanged) | toggle immersive |

- Scale range: 1× (fit) to 4×. Pinching below 1× rubber-bands and springs back to fit on
  release; the same for panning past the photo edge (slight resistance, snap back).
- Zoom state is **per photo and transient**: navigating to another slide, closing the
  lightbox, or rotating the device resets to fit.
- While annotating, pinch stays disabled — the pen owns the pointer (unchanged; the
  container is already `touch-action: none` in that mode).

## How it coexists with the native scroll-snap carousel

This is the crux. The rules:

1. **At fit scale nothing changes.** The container keeps `touch-action: pan-x` +
   `scroll-snap-type: x mandatory`; one-finger swipes stay 100 % native.
2. **A second finger starts the pinch.** Non-passive `touchstart`/`touchmove` listeners on
   the scroll container call `preventDefault()` as soon as two touches are down, which
   stops the native pan *and* any residual browser page-zoom, and hands the gesture to JS.
   A pinch only *starts* when the carousel is settled on a snap point (scrollLeft within a
   few px of `index × width`) — a pinch mid-fling is ignored rather than fighting momentum.
3. **While zoomed the native scroll is suspended.** The container flips to
   `overflow-x: hidden` + `touch-action: none` + `scroll-snap-type: none` — exactly the
   combination the annotating mode already uses — so one-finger drags belong to the JS pan
   handler and can never scroll the carousel. The swipe-down-dismiss handlers early-return
   while zoomed.
4. **Returning to fit restores the native carousel.** Scale animates back to 1, the
   container styles revert, and `scrollLeft` is re-aligned to `currentIndex × clientWidth`
   (the existing layout effect already normalizes this).

The transform is applied **imperatively via a ref** (`transform: translate(x, y) scale(s)`
on a zoom layer, `transition` only for the snap-back/double-tap animations) — consistent
with the existing gesture code: a `touchmove` never re-renders the lightbox.

### What gets transformed

Inside `slideContent`, a new zoom-layer `<div>` wraps exactly the thumb underlay, the
photo `<img>`, and the `AnnotationLayer` — so annotation marks scale and pan with the
photo (their geometry derives from the transformed `imgRef`, which stays inside the
layer). The flag/star badges stay **outside** the layer: they're chrome, not photo, and
must not fly off-screen at 4×. Only the *current* slide gets a zoom layer with handlers;
neighbors render as before.

## Double-tap vs. tap-to-immersive

Single tap currently toggles immersive mode instantly. To detect a double-tap, the compact
path gains a ~250 ms tap window: a second tap inside it zooms; otherwise the single tap
fires immersive after the window. Cost: the chrome toggle on phones/tablets lags a quarter
second — the standard trade-off every photo viewer makes. Desktop click behavior is
unchanged (no window).

## Rendition sharpness while zoomed

Phones serve the `small` rendition (1024/1280 px) — at 2–3× on a 3× DPR screen that is
visibly soft. On the first zoom past ~1.2×, the current slide upgrades its `src` to
`medium` via the existing `variantSrc(im, "medium")` (watermark-proxy-aware, so the
watermark is never bypassed). The upgrade swaps only after the new image has loaded and
decoded — the `small` rendition stays on screen until then, so there's no flash. The
upgrade sticks for that slide while the lightbox is open (no downgrade churn). iPads that
already show `medium` (they're `compact` too, so they don't — they get the same upgrade
path) simply skip a no-op swap.

Originals are **not** fetched for zoom: `original_url` may be a 50 MB RAW/TIFF and is
gated by download permissions; `medium` (1920/2560 px) is the ceiling, which also bounds
the useful max scale (~4×).

## Implementation shape

| File | Change |
|---|---|
| `src/lib/pinch-zoom.ts` (new) | Pure math: pinch midpoint/scale composition, pan clamping to the rendered photo box, rubber-band, double-tap target transform. Unit-tested (Vitest, like the sort logic). |
| `src/hooks/usePinchZoom.ts` (new) | The gesture hook: non-passive listeners, refs for transform state, imperative style writes, suspend/restore of the carousel styles, the rendition-upgrade trigger, reset on index change/unmount. |
| `src/components/gallery/Lightbox.tsx` | Mount the hook on the compact carousel; zoom layer in `slideContent`; tap→double-tap window on compact; early-return in the dismiss handlers while zoomed. |

No i18n strings, no API/schema changes, no new dependencies (hand-rolled like the rest of
the gesture code — a library such as `use-gesture` would be the alternative, but the
existing carousel is already bespoke and a dependency would have to be fought into the
same imperative model anyway).

## Testing

- Vitest: `pinch-zoom.ts` math (clamp bounds for portrait/landscape/fill photos, midpoint
  invariance — the point under the fingers stays under the fingers, rubber-band curve,
  double-tap toggle targets).
- Manual on real devices (iPhone + iPad Safari): pinch/pan/double-tap; swipe still snaps
  one photo per gesture at fit; swipe-down dismiss unaffected at fit and inert while
  zoomed; annotation mode unaffected; watermarked gallery upgrades to the watermarked
  `medium`; protected galleries (`protectImages`) still suppress the long-press sheet.
- E2E: none — Playwright can't meaningfully synthesize multi-touch pinches; the existing
  smoke test already covers lightbox open/navigate.

## Deployment impact

Frontend-only. No migration, no nginx/compose change — a normal image pull & `up -d`
delivers it.
