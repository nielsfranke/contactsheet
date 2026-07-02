// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef } from "react";
import {
  FIT,
  MIN_SCALE,
  doubleTapTarget,
  fitSize,
  rubberBandPan,
  settle,
  softClampScale,
  zoomAround,
  type ZoomTransform,
} from "@/lib/pinch-zoom";

/**
 * Pinch-to-zoom / double-tap-zoom / pan-while-zoomed for the touch lightbox's native scroll-snap
 * carousel (see docs/architecture/lightbox-pinch-zoom.md).
 *
 * Contract with the carousel:
 * - At fit scale the hook is a bystander — one-finger gestures stay 100% native (scroll-snap swipe,
 *   swipe-down dismiss). Its touchmove handler never preventDefaults a native pan.
 * - A second finger (from a settled snap point) preventDefaults and takes the gesture; while zoomed
 *   the container's scroll is suspended (overflow hidden / touch-action none / snap off) so
 *   one-finger drags pan the photo in JS. Returning to fit restores the native styles and re-aligns
 *   scrollLeft. `activeRef` is true exactly while suspended — the dismiss handlers gate on it.
 * - The transform is written imperatively to `layerRef` (the current slide's zoom layer): a
 *   touchmove never re-renders the lightbox, matching the rest of the gesture code.
 * - Taps route through the hook (touch can't use a plain onClick once a double-tap must be told
 *   apart): a single tap on the photo fires `onSingleTap` after the double-tap window.
 */

const DOUBLE_TAP_MS = 250;
/** Max distance between two taps to count as a double-tap. */
const DOUBLE_TAP_SLOP = 30;
/** Max finger travel for a touch to still count as a tap. */
const TAP_SLOP = 10;
/** scrollLeft must sit within this of the current snap point for a zoom to start. */
const SNAP_TOLERANCE = 4;
/** First zoom past this scale requests the sharper rendition (onUpgrade). */
const UPGRADE_SCALE = 1.2;
const SETTLE_MS = 220;
const SETTLE_EASE = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;

interface Point {
  x: number;
  y: number;
}

interface Options {
  /** The scroll-snap carousel container (gesture surface + the scroll to suspend). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** compact && !annotating && a zoomable photo is current. */
  enabled: boolean;
  currentIndex: number;
  /** Container styles to reinstate when the zoom releases the carousel — must mirror what the
   *  lightbox renders for the current mode (annotating-aware). */
  getRestoreStyle: () => { overflowX: string; scrollSnapType: string; touchAction: string };
  /** A confirmed single tap on the photo (fires after the double-tap window). */
  onSingleTap: () => void;
  /** First zoom-in on the current photo — the lightbox warms + swaps in the sharper rendition. */
  onUpgrade: () => void;
}

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function usePinchZoom(opts: Options) {
  /** Assigned to the current slide's zoom layer (wraps photo + annotation marks). */
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** True exactly while the zoom owns the carousel (suspended scroll). Read by dismiss handlers. */
  const activeRef = useRef(false);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const t = useRef<ZoomTransform>({ ...FIT });
  const pinch = useRef<{ dist: number; mid: Point; origin: Point; start: ZoomTransform } | null>(null);
  const pan = useRef<{ x: number; y: number; start: ZoomTransform } | null>(null);
  const suspended = useRef(false);
  /** Tap candidate for the current touch (photo target, hasn't exceeded TAP_SLOP). */
  const tapStart = useRef<Point | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether onUpgrade fired for the current photo (reset on navigation). */
  const upgraded = useRef(false);
  /** The element last painted with a non-identity transform — reset must clear *that* element,
   *  even if layerRef has already moved on to another slide's layer. */
  const paintedEl = useRef<HTMLElement | null>(null);
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!opts.enabled) return;
    const el = optsRef.current.scrollRef.current;
    if (!el) return;

    function box() {
      return { cw: el!.clientWidth, ch: el!.clientHeight };
    }

    /** The photo's object-contain box at fit scale (container box until the img has decoded). */
    function fitOf() {
      const { cw, ch } = box();
      const img = layerRef.current?.querySelector<HTMLImageElement>("img[data-lightbox-photo]");
      return fitSize(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0, cw, ch);
    }

    function containerCenter(): Point {
      const r = el!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function midpoint(a: Touch, b: Touch, origin: Point): Point {
      return { x: (a.clientX + b.clientX) / 2 - origin.x, y: (a.clientY + b.clientY) / 2 - origin.y };
    }

    function paint(nt: ZoomTransform, animate: boolean) {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transition = animate ? SETTLE_EASE : "none";
      layer.style.transform = `translate(${nt.tx}px, ${nt.ty}px) scale(${nt.scale})`;
      paintedEl.current = layer;
    }

    /** Take the carousel: freeze the native scroll so one-finger drags belong to the JS pan. */
    function suspend() {
      if (suspended.current) return;
      el!.style.overflowX = "hidden";
      el!.style.scrollSnapType = "none";
      el!.style.touchAction = "none";
      suspended.current = true;
      activeRef.current = true;
    }

    /** Give the carousel back (mode-aware styles) and re-align to the current snap point. */
    function release() {
      if (!suspended.current) return;
      const s = optsRef.current.getRestoreStyle();
      el!.style.overflowX = s.overflowX;
      el!.style.scrollSnapType = s.scrollSnapType;
      el!.style.touchAction = s.touchAction;
      el!.scrollLeft = optsRef.current.currentIndex * el!.clientWidth;
      suspended.current = false;
      activeRef.current = false;
    }

    function maybeUpgrade(scale: number) {
      if (upgraded.current || scale < UPGRADE_SCALE) return;
      upgraded.current = true;
      optsRef.current.onUpgrade();
    }

    /** Snap overshoot back into bounds; at fit scale, hand the carousel back. */
    function settleGesture() {
      const { cw, ch } = box();
      const st = settle(t.current, fitOf(), cw, ch);
      t.current = st;
      paint(st, true);
      if (st.scale <= MIN_SCALE + 0.001) release();
    }

    function atSnapPoint(): boolean {
      return Math.abs(el!.scrollLeft - optsRef.current.currentIndex * el!.clientWidth) <= SNAP_TOLERANCE;
    }

    function reset() {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      pinch.current = null;
      pan.current = null;
      tapStart.current = null;
      lastTap.current = null;
      upgraded.current = false;
      t.current = { ...FIT };
      if (paintedEl.current) {
        paintedEl.current.style.transition = "none";
        paintedEl.current.style.transform = "";
        paintedEl.current = null;
      }
      release();
    }
    resetRef.current = reset;

    function onTouchStart(e: TouchEvent) {
      // Any new touch cancels a pending single-tap resolution (it may be a double-tap's 2nd tap).
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      if (e.touches.length === 2) {
        tapStart.current = null;
        // Only pinch from a settled snap point — suspending mid-fling would freeze the carousel
        // between two photos. (touch-action pan-x means the browser can't zoom here either; the
        // ignored gesture just pans the carousel.)
        if (!suspended.current && !atSnapPoint()) return;
        e.preventDefault();
        const origin = containerCenter();
        pan.current = null;
        pinch.current = {
          dist: touchDist(e.touches[0], e.touches[1]),
          mid: midpoint(e.touches[0], e.touches[1], origin),
          origin,
          start: { ...t.current },
        };
        suspend();
        paint(t.current, false); // cancel any in-flight settle animation
      } else if (e.touches.length === 1) {
        const tp = e.touches[0];
        if (t.current.scale > MIN_SCALE + 0.001) {
          pan.current = { x: tp.clientX, y: tp.clientY, start: { ...t.current } };
          paint(t.current, false);
        }
        // Taps only count on the photo itself (not letterbox, badges or annotation marks).
        tapStart.current = e.target instanceof HTMLImageElement ? { x: tp.clientX, y: tp.clientY } : null;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (pinch.current && e.touches.length >= 2) {
        e.preventDefault();
        tapStart.current = null;
        const p = pinch.current;
        const { cw, ch } = box();
        const scale = softClampScale(p.start.scale * (touchDist(e.touches[0], e.touches[1]) / p.dist));
        const m = midpoint(e.touches[0], e.touches[1], p.origin);
        const zoomed = zoomAround(p.start, p.mid, scale);
        // Two-finger drift pans along with the zoom (fingers move together → photo follows).
        const nt = rubberBandPan(
          { scale, tx: zoomed.tx + (m.x - p.mid.x), ty: zoomed.ty + (m.y - p.mid.y) },
          fitOf(),
          cw,
          ch,
        );
        t.current = nt;
        paint(nt, false);
        maybeUpgrade(scale);
      } else if (pan.current && e.touches.length === 1) {
        e.preventDefault();
        const tp = e.touches[0];
        if (tapStart.current && Math.hypot(tp.clientX - tapStart.current.x, tp.clientY - tapStart.current.y) > TAP_SLOP) {
          tapStart.current = null;
        }
        const { cw, ch } = box();
        const nt = rubberBandPan(
          {
            scale: pan.current.start.scale,
            tx: pan.current.start.tx + (tp.clientX - pan.current.x),
            ty: pan.current.start.ty + (tp.clientY - pan.current.y),
          },
          fitOf(),
          cw,
          ch,
        );
        t.current = nt;
        paint(nt, false);
      } else if (tapStart.current && e.touches.length === 1) {
        // Native scroll owns this drag — just stop it from ending as a tap.
        const tp = e.touches[0];
        if (Math.hypot(tp.clientX - tapStart.current.x, tp.clientY - tapStart.current.y) > TAP_SLOP) {
          tapStart.current = null;
        }
      }
    }

    function doubleTap(tp: Touch) {
      if (t.current.scale > MIN_SCALE + 0.001) {
        t.current = { ...FIT };
        paint(t.current, true);
        release();
        return;
      }
      if (!atSnapPoint()) return;
      const { cw, ch } = box();
      const origin = containerCenter();
      suspend();
      const nt = doubleTapTarget(
        { ...FIT },
        { x: tp.clientX - origin.x, y: tp.clientY - origin.y },
        fitOf(),
        cw,
        ch,
      );
      t.current = nt;
      paint(nt, true);
      maybeUpgrade(nt.scale);
    }

    function handleTap(tp: Touch) {
      const now = Date.now();
      const prev = lastTap.current;
      if (
        prev &&
        now - prev.at < DOUBLE_TAP_MS + 50 &&
        Math.hypot(tp.clientX - prev.x, tp.clientY - prev.y) < DOUBLE_TAP_SLOP
      ) {
        lastTap.current = null;
        doubleTap(tp);
        return;
      }
      lastTap.current = { x: tp.clientX, y: tp.clientY, at: now };
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        lastTap.current = null;
        optsRef.current.onSingleTap();
      }, DOUBLE_TAP_MS);
    }

    function onTouchEnd(e: TouchEvent) {
      if (pinch.current && e.touches.length < 2) {
        pinch.current = null;
        if (e.touches.length === 1) {
          // One finger lifted: settle any scale overshoot, keep panning with the remaining finger.
          const { cw, ch } = box();
          const st = settle(t.current, fitOf(), cw, ch);
          t.current = st;
          paint(st, true);
          if (st.scale <= MIN_SCALE + 0.001) release();
          else pan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, start: { ...st } };
          return;
        }
        settleGesture();
        return;
      }
      if (pan.current && e.touches.length === 0) {
        pan.current = null;
        settleGesture();
        // fall through — a motionless touch while zoomed is still a tap (immersive / double-tap out)
      }
      if (e.touches.length === 0) {
        if (tapStart.current) handleTap(e.changedTouches[0]);
        tapStart.current = null;
      }
    }

    function onTouchCancel() {
      pinch.current = null;
      pan.current = null;
      tapStart.current = null;
      settleGesture();
    }

    // Rotation / viewport change invalidates every cached geometry assumption — back to fit.
    function onResize() {
      reset();
    }

    // Non-passive: touchstart/move must be able to preventDefault to take the gesture from the
    // native scroll (browsers register touch listeners passive by default).
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("resize", onResize);
      reset();
      resetRef.current = null;
    };
    // The handlers read live values through optsRef; only enabling/disabling re-binds.
  }, [opts.enabled]);

  // Navigating to another photo resets the zoom (per-photo, transient state).
  useEffect(() => {
    resetRef.current?.();
  }, [opts.currentIndex]);

  return { layerRef, activeRef };
}
