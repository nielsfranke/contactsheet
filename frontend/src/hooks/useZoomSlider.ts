// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useMemo, useRef } from "react";
import { FIT, MAX_SCALE, MIN_SCALE, clampPan, fitSize, zoomTo, type FitBox, type ZoomTransform } from "@/lib/pinch-zoom";

/**
 * Desktop lightbox zoom for review contexts — slider / wheel / drag-to-pan (see
 * docs/architecture/lightbox-zoom-slider.md). The touch counterpart is usePinchZoom; the two write
 * to the same zoom layer but are mutually exclusive via the lightbox's `compact` gate.
 *
 * Contract with the lightbox:
 * - The transform is written imperatively to `layerRef` (the current slide's zoom layer) — a wheel
 *   tick or pan never re-renders the lightbox, matching the rest of the gesture code.
 * - The zoom percent is exposed as a tiny external store (`getPercent`/`subscribe`) so only the
 *   small slider control re-renders while zooming, never the whole lightbox.
 * - `activeRef` is true exactly while zoomed past fit — the desktop JS touch-swipe handlers gate on
 *   it (like the mobile dismiss handlers gate on the pinch hook's activeRef).
 * - A pan-drag ends in a browser `click` on the photo, which would toggle immersive mode; the hook
 *   swallows that click in the capture phase when the pointer actually moved.
 */

/** Max pointer travel for a press to still count as a click (immersive toggle passes through). */
const CLICK_SLOP = 5;
/** First zoom past this scale requests the sharper rendition (onUpgrade — bumps srcset `sizes`). */
const UPGRADE_SCALE = 1.2;
/** Wheel delta → scale factor. ctrlKey wheels are trackpad pinches (fine-grained deltas). */
const WHEEL_SENSITIVITY = 0.0015;
const PINCH_SENSITIVITY = 0.01;

interface Options {
  /** The lightbox image area — wheel/pointer surface and the geometry reference. */
  areaRef: React.RefObject<HTMLDivElement | null>;
  /** !compact && review context && a zoomable photo is current. */
  enabled: boolean;
  /** While annotating the pen owns the drag — pan stands down, wheel/slider keep zooming. */
  panDisabled?: boolean;
  /** Configured ceiling (settings): a fit-relative scale (2/3/4), or "original" — the current
   *  photo's 1:1 original pixel size (varies per photo, derived from originalWidth / fit width). */
  zoomMax?: number | "original";
  /** The current photo's original pixel width (image.width) — only used for zoomMax "original". */
  originalWidth?: number | null;
  currentIndex: number;
  /** First zoom-in on the current photo — the lightbox bumps `sizes` so srcset re-picks. */
  onUpgrade: () => void;
}

export interface ZoomSliderState {
  /** Current zoom percent, 100 = fit. */
  percent: number;
  /** Slider ceiling in percent (≥ 100; == 100 means nothing to zoom — the control hides). */
  maxPercent: number;
}

export interface ZoomSliderApi {
  /** Assigned to the current slide's zoom layer (wraps photo + annotation marks). */
  layerRef: React.RefObject<HTMLDivElement | null>;
  /** True exactly while zoomed past fit. Read by the desktop touch-swipe handlers. */
  activeRef: React.RefObject<boolean>;
  getState: () => ZoomSliderState;
  /** Control-only subscription — returns the unsubscribe. */
  subscribe: (cb: (state: ZoomSliderState) => void) => () => void;
  /** Slider input: zoom to a percent around the viewport center. */
  setPercent: (percent: number) => void;
  /** Back to fit (magnifier button; also runs on navigation / disable). */
  reset: () => void;
}

export function useZoomSlider(opts: Options): ZoomSliderApi {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const t = useRef<ZoomTransform>({ ...FIT });
  const pan = useRef<{ x: number; y: number; start: ZoomTransform; moved: boolean } | null>(null);
  /** Set when a pan-drag actually moved — the next click is swallowed (no immersive toggle). */
  const suppressClick = useRef(false);
  /** Whether onUpgrade fired for the current photo (reset on navigation). */
  const upgraded = useRef(false);
  /** The element last painted with a non-identity transform — reset must clear *that* element,
   *  even if layerRef has already moved on to another slide's layer. */
  const paintedEl = useRef<HTMLElement | null>(null);
  const listeners = useRef(new Set<(state: ZoomSliderState) => void>());

  // Stable across renders: paint/apply/reset close over refs only.
  const api = useMemo(() => {
    function percentOf(scale: number): number {
      return Math.round(scale * 100);
    }

    /** The photo's object-contain box at fit scale (container box until the img has decoded). */
    function fitOf(cw: number, ch: number) {
      const img = layerRef.current?.querySelector<HTMLImageElement>("img[data-lightbox-photo]");
      return fitSize(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0, cw, ch);
    }

    /** The configured zoom ceiling for the current photo. "original" derives it from the photo's
     *  original pixel width vs. the rendered fit width (≥ 1 — a photo smaller than its fit box has
     *  nothing to zoom into). Unknown original → the built-in 4× default. */
    function maxScaleOf(fit: FitBox): number {
      const zm = optsRef.current.zoomMax ?? MAX_SCALE;
      if (zm !== "original") return Math.max(MIN_SCALE, zm);
      const ow = optsRef.current.originalWidth;
      if (!ow || fit.w <= 0) return MAX_SCALE;
      return Math.max(MIN_SCALE, ow / fit.w);
    }

    function state(): ZoomSliderState {
      const area = optsRef.current.areaRef.current;
      const fit = area ? fitOf(area.clientWidth, area.clientHeight) : { w: 0, h: 0 };
      return { percent: percentOf(t.current.scale), maxPercent: percentOf(maxScaleOf(fit)) };
    }

    function emit() {
      const s = state();
      for (const cb of listeners.current) cb(s);
    }

    function paint(nt: ZoomTransform, panning: boolean) {
      const layer = layerRef.current;
      if (!layer) return;
      const zoomed = nt.scale > MIN_SCALE + 0.001;
      layer.style.transform = zoomed ? `translate(${nt.tx}px, ${nt.ty}px) scale(${nt.scale})` : "";
      layer.style.cursor = zoomed && !optsRef.current.panDisabled ? (panning ? "grabbing" : "grab") : "";
      // Read by the AnnotationLayer's note popover to counter-scale itself (stay readable while
      // annotating zoomed) — flows through CSS, so a zoom change never re-renders the layer.
      layer.style.setProperty("--zoom-scale", String(nt.scale));
      paintedEl.current = zoomed ? layer : null;
      activeRef.current = zoomed;
    }

    /** Zoom to an absolute scale around a center-relative focal point. */
    function apply(scale: number, focal: { x: number; y: number }) {
      const area = optsRef.current.areaRef.current;
      if (!area) return;
      const cw = area.clientWidth;
      const ch = area.clientHeight;
      const fit = fitOf(cw, ch);
      const nt = zoomTo(t.current, scale, focal, fit, cw, ch, maxScaleOf(fit));
      t.current = nt;
      paint(nt, false);
      emit();
      if (!upgraded.current && nt.scale >= UPGRADE_SCALE) {
        upgraded.current = true;
        optsRef.current.onUpgrade();
      }
    }

    function reset() {
      pan.current = null;
      suppressClick.current = false;
      upgraded.current = false;
      t.current = { ...FIT };
      activeRef.current = false;
      if (paintedEl.current) {
        paintedEl.current.style.transform = "";
        paintedEl.current.style.cursor = "";
        paintedEl.current.style.removeProperty("--zoom-scale");
        paintedEl.current = null;
      }
      emit();
    }

    return {
      layerRef,
      activeRef,
      getState: state,
      subscribe: (cb: (state: ZoomSliderState) => void) => {
        listeners.current.add(cb);
        return () => listeners.current.delete(cb);
      },
      setPercent: (percent: number) => apply(percent / 100, { x: 0, y: 0 }),
      reset,
      /** internal — event handlers below. */
      _apply: apply,
      _paint: paint,
      _fitOf: fitOf,
    };
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;
    const el = optsRef.current.areaRef.current;
    if (!el) return;

    // Zoom around the cursor: the photo point under it stays put (same invariant as the pinch).
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      const focal = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY));
      api._apply(t.current.scale * factor, focal);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0 || optsRef.current.panDisabled || t.current.scale <= MIN_SCALE + 0.001) return;
      // Chrome inside the area (chevrons, the slider pill) keeps its own pointer behavior.
      if (e.target instanceof Element && e.target.closest("button, input, a")) return;
      pan.current = { x: e.clientX, y: e.clientY, start: { ...t.current }, moved: false };
      el!.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      const p = pan.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) > CLICK_SLOP) p.moved = true;
      const cw = el!.clientWidth;
      const ch = el!.clientHeight;
      const nt = clampPan(
        { scale: p.start.scale, tx: p.start.tx + dx, ty: p.start.ty + dy },
        api._fitOf(cw, ch),
        cw,
        ch,
      );
      t.current = nt;
      api._paint(nt, true);
    }

    function onPointerUp(e: PointerEvent) {
      const p = pan.current;
      if (!p) return;
      pan.current = null;
      suppressClick.current = p.moved;
      if (el!.hasPointerCapture(e.pointerId)) el!.releasePointerCapture(e.pointerId);
      api._paint(t.current, false);
    }

    // Capture phase: swallow the click a pan-drag ends in, before the photo's immersive toggle.
    function onClickCapture(e: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }

    // Viewport change invalidates every cached geometry assumption — back to fit.
    function onResize() {
      api.reset();
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("resize", onResize);
      api.reset();
    };
    // Handlers read live values through optsRef/api (stable); only enabling/disabling re-binds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // Navigating to another photo resets the zoom (per-photo, transient state).
  useEffect(() => {
    api.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.currentIndex]);

  // Toggling annotate flips pan availability — repaint so the grab cursor appears/disappears.
  useEffect(() => {
    api._paint(t.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.panDisabled]);

  return api;
}
