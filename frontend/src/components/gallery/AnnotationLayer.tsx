// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Anchor, AnchorPoint, Comment } from "@/lib/types";
import type { LightboxTones } from "@/lib/lightbox-theme";

interface Props {
  /** The rendered <img> the marks are anchored to. The layer measures its content rect. */
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** All comments for the image; anchored ones (anchor != null) render as marks. */
  comments: Comment[];
  /** Whether the freehand pen is active (drawing mode). When false the layer is view-only. */
  drawing: boolean;
  /** Whether saved marks are visible (the eye/Spline toggle). Drawing forces them on. */
  showMarks?: boolean;
  /** Color for new strokes. */
  color: string;
  /** Stroke width (px) for a new freehand mark. */
  strokeWidth?: number;
  onCreate: (anchor: Anchor, text: string) => void;
  creating?: boolean;
  /** Stable mark number per comment id (shared with the comment list so labels match). */
  numbers?: Record<string, number>;
  /** Comment id currently highlighted (hovered in either the overlay or the comment list). */
  highlightId?: string | null;
  onHover?: (id: string | null) => void;
  /** Whether the viewer may delete a given mark (admin, or own). Enables a hover trash button. */
  canDelete?: (authorName: string) => boolean;
  onDelete?: (commentId: string) => void;
  /** Lightbox backdrop tones — so the note popover matches a light vs dark backdrop. */
  tones: LightboxTones;
}

/** Default stroke width when an older mark didn't store one. */
const DEFAULT_STROKE = 2.5;

/** A small pencil cursor (hotspot at the tip, bottom-left) used while drawing. Base64-encoded SVG so
 *  Chrome accepts it without character-escaping pitfalls. */
const PENCIL_CURSOR =
  "url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj48cGF0aCBkPSJNMTMgMS41bDUuNSA1LjUtOS41IDkuNS02IDEuNSAxLjUtNnoiIGZpbGw9IiNmZmZmZmYiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48cGF0aCBkPSJNMTEuNSAzbDUuNSA1LjUiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz48L3N2Zz4=\") 2 18, crosshair";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Measure the rendered image's content box relative to its offset parent (the layer root).
 *  Computes the object-contain content rect from the element box + the image's natural size, so it
 *  aligns whether the <img> hugs its content (max-w/max-h) or fills the slide (w/h-full) and is
 *  letterboxed inside. Expressed relative to the layer so marks position correctly. */
function useContentRect(
  imgRef: React.RefObject<HTMLImageElement | null>,
  rootRef: React.RefObject<HTMLDivElement | null>,
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const img = imgRef.current;
    const root = rootRef.current;
    if (!img || !root) return;

    function measure() {
      const i = imgRef.current;
      const r = rootRef.current;
      if (!i || !r) return;
      const ib = i.getBoundingClientRect();
      const rb = r.getBoundingClientRect();
      // Object-contain content box within the element box (centered, aspect-preserved). For an
      // element that already hugs its content this is a no-op; for a filled element it backs out the
      // letterbox margins so marks land on the photo, not the slide.
      const nw = i.naturalWidth;
      const nh = i.naturalHeight;
      let cw = ib.width, ch = ib.height, cl = ib.left, ct = ib.top;
      if (nw > 0 && nh > 0) {
        const scale = Math.min(ib.width / nw, ib.height / nh);
        cw = nw * scale;
        ch = nh * scale;
        cl = ib.left + (ib.width - cw) / 2;
        ct = ib.top + (ib.height - ch) / 2;
      }
      setRect({ left: cl - rb.left, top: ct - rb.top, width: cw, height: ch });
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    ro.observe(root);
    img.addEventListener("load", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      img.removeEventListener("load", measure);
      window.removeEventListener("resize", measure);
    };
  }, [imgRef, rootRef]);

  return rect;
}

// Skip points closer than this (normalized) so a stroke stays well under the 1000-point cap.
const SAMPLE_DIST = 0.004;

/** The point a mark's number badge sits on (stroke start, or the vector corner). */
function originOf(a: Anchor): AnchorPoint {
  if (a.type === "freehand") return a.points?.[0] ?? { x: 0, y: 0 };
  return { x: a.x ?? 0, y: a.y ?? 0 };
}

function toPolyline(points: AnchorPoint[]): string {
  return points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
}

export function AnnotationLayer({
  imgRef,
  comments,
  drawing,
  showMarks = true,
  color,
  strokeWidth = DEFAULT_STROKE,
  onCreate,
  creating = false,
  numbers,
  highlightId,
  onHover,
  canDelete,
  onDelete,
  tones,
}: Props) {
  const t = useTranslations("gallery.annotations");
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const rect = useContentRect(imgRef, rootRef);

  const [stroke, setStroke] = useState<AnchorPoint[] | null>(null); // in-progress drag
  const [pending, setPending] = useState<Anchor | null>(null); // finished, awaiting a note
  const [note, setNote] = useState("");

  const anchored = comments
    .filter((c) => c.anchor)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Marks (stroke/rect hit-areas, number badges, delete affordance) stay selectable even while
  // drawing, so an annotation can be tapped and deleted without first leaving annotation mode —
  // matching view mode. Only suppressed while a note popover is open (pending). The stroke/rect hit
  // areas do NOT stopPropagation, so a *drag* starting on a mark still draws a new stroke (the
  // pointerdown bubbles to the surface) while a *tap* — ignored as a 1-point stroke — highlights it.
  // The precise badge + trash targets DO stopPropagation, since a tap there should never draw.
  const marksInteractive = !pending;

  function frac(e: React.PointerEvent): AnchorPoint {
    const s = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - s.left) / s.width)),
      y: Math.min(1, Math.max(0, (e.clientY - s.top) / s.height)),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!drawing || pending) return;
    e.preventDefault();
    surfaceRef.current?.setPointerCapture(e.pointerId);
    setStroke([frac(e)]);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!stroke) return;
    const p = frac(e);
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < SAMPLE_DIST) return;
    setStroke((s) => (s ? [...s, p] : s));
  }

  function handlePointerUp() {
    if (!stroke) return;
    const pts = stroke;
    setStroke(null);
    if (pts.length < 2) return; // a tap with no movement — ignore
    setPending({ type: "freehand", points: pts, color, width: strokeWidth });
    setNote("");
  }

  function cancel() {
    setPending(null);
    setNote("");
  }

  function save() {
    if (!pending || !note.trim()) return;
    onCreate(pending, note.trim());
    setPending(null);
    setNote("");
  }

  if (!rect) {
    return <div ref={rootRef} className="absolute inset-0 z-20 pointer-events-none" />;
  }

  const surfaceStyle: React.CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };

  // Note popover position: anchor to the pending stroke's bbox, flipping above / clamping sideways.
  let popX = 0;
  let popTopFrac = 0;
  let popAbove = false;
  if (pending?.points) {
    const xs = pending.points.map((p) => p.x);
    const ys = pending.points.map((p) => p.y);
    popX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    popAbove = bottom > 0.6;
    popTopFrac = popAbove ? top : bottom;
  }
  const popTx = popX < 0.2 ? "0%" : popX > 0.8 ? "-100%" : "-50%";
  const popTy = popAbove ? "calc(-100% - 8px)" : "8px";

  return (
    // z-20 lifts the layer above the photo (`relative z-10`) so the drawing surface and mark
    // hit-areas actually receive pointer events; the root stays pointer-events-none, so taps outside
    // an interactive child still fall through to the image (immersive toggle).
    <div ref={rootRef} className="absolute inset-0 z-20 pointer-events-none">
      <div
        ref={surfaceRef}
        className={`absolute ${drawing && !pending ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{
          ...surfaceStyle,
          cursor: drawing && !pending ? PENCIL_CURSOR : undefined,
          // The pen owns the gesture while drawing — disable the browser's native pan/zoom so a
          // stroke (or stray touch) can't pinch/double-tap-zoom the page on mobile.
          touchAction: drawing ? "none" : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Vector shapes (freehand strokes + legacy pin/rect). Root is pointer-events:none; the
            transparent hit polylines opt back in (pointer-events:stroke) in view mode. */}
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        >
          {showMarks && anchored.map((c) => {
            const a = c.anchor!;
            if (a.type !== "freehand" || !a.points) return null;
            const mc = a.color ?? color;
            const hot = c.id === highlightId;
            const sw = a.width ?? DEFAULT_STROKE;
            const pl = toPolyline(a.points);
            return (
              <g key={c.id}>
                {hot && (
                  <polyline
                    points={pl}
                    fill="none"
                    stroke="white"
                    strokeWidth={sw + 3}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <polyline
                  points={pl}
                  fill="none"
                  stroke={mc}
                  strokeWidth={sw}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ pointerEvents: "none" }}
                />
                {/* fat transparent hit area for hover (only when not drawing) */}
                <polyline
                  points={pl}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(22, sw + 16)}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: marksInteractive ? "stroke" : "none", cursor: "pointer" }}
                  onMouseEnter={() => onHover?.(c.id)}
                  onMouseLeave={() => onHover?.(null)}
                  onClick={() => onHover?.(c.id)}
                />
              </g>
            );
          })}

          {/* legacy rect marks */}
          {showMarks && anchored.map((c) => {
            const a = c.anchor!;
            if (a.type !== "rect") return null;
            const mc = a.color ?? color;
            const hot = c.id === highlightId;
            return (
              <rect
                key={c.id}
                x={(a.x ?? 0) * 100}
                y={(a.y ?? 0) * 100}
                width={(a.w ?? 0) * 100}
                height={(a.h ?? 0) * 100}
                fill={`${mc}1f`}
                stroke={mc}
                strokeWidth={hot ? 3 : 2}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: marksInteractive ? "all" : "none", cursor: "pointer" }}
                onMouseEnter={() => onHover?.(c.id)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onHover?.(c.id)}
              />
            );
          })}

          {/* in-progress stroke */}
          {stroke && stroke.length > 1 && (
            <polyline
              points={toPolyline(stroke)}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* pending stroke (awaiting note) */}
          {pending?.points && (
            <polyline
              points={toPolyline(pending.points)}
              fill="none"
              stroke={color}
              strokeWidth={pending.width ?? strokeWidth}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
          )}
        </svg>

        {/* Number badges (the hover/click target for each mark) */}
        {showMarks && anchored.map((c) => {
          const a = c.anchor!;
          const o = originOf(a);
          const mc = a.color ?? color;
          const num = numbers?.[c.id];
          const hot = c.id === highlightId;
          if (num == null) return null;
          return (
            <button
              key={c.id}
              type="button"
              title={`${c.author_name}: ${c.text}`}
              onMouseEnter={() => onHover?.(c.id)}
              onMouseLeave={() => onHover?.(null)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onHover?.(c.id)}
              className={`absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full text-[11px] font-bold text-white flex items-center justify-center shadow transition-transform ${
                marksInteractive ? "pointer-events-auto" : "pointer-events-none"
              } ${hot ? "scale-125 ring-2 ring-white" : "hover:scale-110"}`}
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, backgroundColor: mc }}
            >
              {num}
            </button>
          );
        })}

        {/* Delete affordance — floats next to the highlighted mark's badge when deletable. Shown even
            while drawing so an annotation can be deleted without leaving annotation mode. */}
        {showMarks && marksInteractive && onDelete && anchored.map((c) => {
          if (c.id !== highlightId || !canDelete?.(c.author_name)) return null;
          const o = originOf(c.anchor!);
          return (
            <button
              key={`del-${c.id}`}
              type="button"
              title={t("delete")}
              onMouseEnter={() => onHover?.(c.id)}
              onMouseLeave={() => onHover?.(null)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className={`absolute pointer-events-auto w-5 h-5 ml-3 -mt-2.5 rounded-full border ${tones.panel} ${tones.strong} hover:text-red-400 hover:border-red-400 flex items-center justify-center shadow`}
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%` }}
            >
              <Trash2 size={11} />
            </button>
          );
        })}

        {/* Note popover */}
        {pending && (
          <div
            className={`absolute pointer-events-auto z-10 w-60 rounded-lg border ${tones.panel} p-3 shadow-2xl`}
            style={{ left: `${popX * 100}%`, top: `${popTopFrac * 100}%`, transform: `translate(${popTx}, ${popTy})` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              maxLength={2000}
              rows={3}
              className={`w-full resize-none rounded-md border ${tones.field} text-sm p-2 focus:outline-none focus:ring-2 focus:ring-ring`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                if (e.key === "Escape") cancel();
              }}
            />
            {/* Save/Cancel. Tones follow the lightbox backdrop (lightboxTones) so the popover is
                readable on a light/white backdrop, not just the dark default. */}
            <div className="flex justify-end gap-2 mt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-7 text-xs px-3 ${tones.strong} ${tones.hoverBg} ${tones.hoverStrong}`}
                onClick={cancel}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs px-3"
                disabled={!note.trim() || creating}
                onClick={save}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
