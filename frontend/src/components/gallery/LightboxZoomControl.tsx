// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ZoomIn } from "lucide-react";
import type { LightboxTones } from "@/lib/lightbox-theme";
import type { ZoomSliderState } from "@/hooks/useZoomSlider";

/**
 * The desktop review-mode zoom control (right end of the lightbox bottom toolbar, on the same row
 * as the flag/rating actions): magnifier (= reset), slider, live percentage. Subscribes to the zoom
 * hook's external store so wheel/slider zooming re-renders only this control, never the lightbox
 * (see useZoomSlider). The slider ceiling comes from the instance settings (200/300/400 % or the
 * photo's original size); when a photo has nothing to zoom into (ceiling ≈ fit) the control hides.
 */
interface Props {
  getState: () => ZoomSliderState;
  subscribe: (cb: (state: ZoomSliderState) => void) => () => void;
  /** Slider input — zooms around the viewport center. */
  onChange: (percent: number) => void;
  /** Magnifier click — back to fit. */
  onReset: () => void;
  tones: LightboxTones;
}

export function LightboxZoomControl({ getState, subscribe, onChange, onReset, tones }: Props) {
  const t = useTranslations("gallery.lightbox");
  const [{ percent, maxPercent }, setState] = useState(getState);
  useEffect(() => subscribe(setState), [subscribe]);

  // "original" ceiling on a photo no bigger than its fit box — nothing to zoom into.
  if (maxPercent <= 100) return null;

  const { light, muted, hoverStrong } = tones;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onReset}
        title={t("zoomReset")}
        aria-label={t("zoomReset")}
        className={`flex items-center justify-center rounded outline-none focus-visible:ring-2 ${
          light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"
        } ${muted} ${hoverStrong}`}
      >
        <ZoomIn size={14} />
      </button>
      <input
        type="range"
        min={100}
        max={maxPercent}
        step={1}
        value={Math.min(percent, maxPercent)}
        onChange={(e) => onChange(Number(e.target.value))}
        // ←/→ always navigate photos, even with the slider focused: block the native value step
        // here and let the keydown bubble to the window nav handler (lightbox-keys exempts range
        // inputs from its editable-target guard). ↑/↓ still step the zoom for keyboard users.
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
        }}
        aria-label={t("zoom")}
        className={`h-1 w-24 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 ${
          light ? "bg-black/15 focus-visible:ring-black/60" : "bg-white/25 focus-visible:ring-white"
        } [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 ${
          light
            ? "[&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700"
            : "[&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white"
        }`}
      />
      <span className={`w-10 text-right text-xs tabular-nums ${muted}`}>{percent}%</span>
    </div>
  );
}
