// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure math for the touch-lightbox pinch-to-zoom (see docs/architecture/lightbox-pinch-zoom.md).
 *
 * Coordinate system: everything is relative to the *center* of the slide container, matching a CSS
 * `transform: translate(tx, ty) scale(scale)` with the default center transform-origin — a photo
 * point q (center-relative, at fit scale) renders at `q * scale + (tx, ty)`.
 */

export interface ZoomTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** The rendered (object-contain) photo box at fit scale. */
export interface FitBox {
  w: number;
  h: number;
}

export const FIT: ZoomTransform = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

/** Resistance factors while a gesture overshoots the hard limits (snap back on release). */
const PAN_RESIST = 0.25;
const SCALE_UNDER_RESIST = 0.5;
const SCALE_OVER_RESIST = 0.25;

function clamp(v: number, min: number, max: number): number {
  // + 0 normalizes a -0 (clamping a negative against a 0 bound) to +0.
  return Math.min(max, Math.max(min, v)) + 0;
}

/** Object-contain box of a natural-size image inside a container; the container itself when the
 *  natural size is unknown (image not loaded yet) — a safe approximation for pan clamping. */
export function fitSize(naturalW: number, naturalH: number, cw: number, ch: number): FitBox {
  if (naturalW <= 0 || naturalH <= 0) return { w: cw, h: ch };
  const r = Math.min(cw / naturalW, ch / naturalH);
  return { w: naturalW * r, h: naturalH * r };
}

/** Max |translation| per axis: half the overhang of the scaled photo beyond the container; 0 when
 *  the photo still fits (it stays centered on that axis). */
function panBound(scaledDim: number, containerDim: number): number {
  return Math.max(0, (scaledDim - containerDim) / 2);
}

/** Hard-clamp the pan so no photo edge leaves its natural bound. */
export function clampPan(t: ZoomTransform, fit: FitBox, cw: number, ch: number): ZoomTransform {
  const bx = panBound(fit.w * t.scale, cw);
  const by = panBound(fit.h * t.scale, ch);
  return { ...t, tx: clamp(t.tx, -bx, bx), ty: clamp(t.ty, -by, by) };
}

/** Mid-gesture pan limit: inside the bounds it's a no-op; beyond them the excess is compressed
 *  (same ¼-travel feel as the carousel's swipe rubber-band). */
export function rubberBandPan(t: ZoomTransform, fit: FitBox, cw: number, ch: number): ZoomTransform {
  const bx = panBound(fit.w * t.scale, cw);
  const by = panBound(fit.h * t.scale, ch);
  const soft = (v: number, b: number) => (Math.abs(v) <= b ? v : Math.sign(v) * (b + (Math.abs(v) - b) * PAN_RESIST));
  return { ...t, tx: soft(t.tx, bx), ty: soft(t.ty, by) };
}

/** Mid-gesture scale limit: linear resistance below fit and above max (snap back on release). */
export function softClampScale(raw: number): number {
  if (raw < MIN_SCALE) return Math.max(0.5, MIN_SCALE - (MIN_SCALE - raw) * SCALE_UNDER_RESIST);
  if (raw > MAX_SCALE) return MAX_SCALE + (raw - MAX_SCALE) * SCALE_OVER_RESIST;
  return raw;
}

/** Rescale around a focal point (center-relative): the photo point currently under the focal point
 *  stays under it at the new scale — the invariant that makes a pinch feel anchored to the fingers. */
export function zoomAround(t: ZoomTransform, focal: { x: number; y: number }, scale: number): ZoomTransform {
  const qx = (focal.x - t.tx) / t.scale;
  const qy = (focal.y - t.ty) / t.scale;
  return { scale, tx: focal.x - qx * scale, ty: focal.y - qy * scale };
}

/** Release settle: hard-clamp the scale into [MIN, MAX] (pan rescaled proportionally so the view
 *  center holds), then clamp the pan into bounds. At fit scale this always lands exactly on FIT. */
export function settle(t: ZoomTransform, fit: FitBox, cw: number, ch: number): ZoomTransform {
  const scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
  const k = scale / t.scale;
  return clampPan({ scale, tx: t.tx * k, ty: t.ty * k }, fit, cw, ch);
}

/** Double-tap toggle: zoomed → back to fit; at fit → DOUBLE_TAP_SCALE anchored at the tap point,
 *  clamped so the jump never reveals space beyond a photo edge. */
export function doubleTapTarget(
  t: ZoomTransform,
  focal: { x: number; y: number },
  fit: FitBox,
  cw: number,
  ch: number,
): ZoomTransform {
  if (t.scale > MIN_SCALE + 0.01) return { ...FIT };
  return clampPan(zoomAround({ ...FIT }, focal, DOUBLE_TAP_SCALE), fit, cw, ch);
}
