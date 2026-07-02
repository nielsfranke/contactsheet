// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ZoomIn } from "lucide-react";
import type { LightboxTones } from "@/lib/lightbox-theme";

/**
 * The desktop review-mode zoom pill (bottom-right of the lightbox image area): magnifier (= reset),
 * slider, live percentage. Subscribes to the zoom hook's external store so wheel/slider zooming
 * re-renders only this control, never the lightbox (see useZoomSlider).
 */
interface Props {
  getPercent: () => number;
  subscribe: (cb: (percent: number) => void) => () => void;
  /** Slider input — zooms around the viewport center. */
  onChange: (percent: number) => void;
  /** Magnifier click — back to fit. */
  onReset: () => void;
  tones: LightboxTones;
}

export function LightboxZoomControl({ getPercent, subscribe, onChange, onReset, tones }: Props) {
  const t = useTranslations("gallery.lightbox");
  const [percent, setPercent] = useState(getPercent);
  useEffect(() => subscribe(setPercent), [subscribe]);

  const { light, muted, hoverStrong } = tones;
  return (
    <div
      className={`absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-sm ${
        light ? "border-zinc-200 bg-white/85" : "border-white/10 bg-black/55"
      }`}
    >
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
        max={400}
        step={1}
        value={percent}
        onChange={(e) => onChange(Number(e.target.value))}
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
