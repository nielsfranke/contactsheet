// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icons } from "@/lib/ui-icons";

/**
 * 1–5 star rating — the stars-mode alternative to the color-flag dot/picker.
 *
 * Read-only when `onChange` is omitted (just shows the filled count). Interactive otherwise:
 * hover previews the fill, click sets the rating, clicking the current rating clears it (→ 0).
 * Theming (star colour, hover background) is left to the caller via `className`/`starClassName`
 * so the same control fits a bright grid tile, a dark hero, and the lightbox.
 */
export function StarRating({
  value,
  onChange,
  size = 16,
  className,
  starClassName = "text-amber-400",
  emptyClassName = "text-white/30",
}: {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  className?: string;
  /** Class for filled stars. */
  starClassName?: string;
  /** Class for empty stars. */
  emptyClassName?: string;
}) {
  const t = useTranslations("gallery.stars");
  const [hover, setHover] = useState(0);
  const interactive = !!onChange;
  // While hovering an interactive control, preview the hovered fill; otherwise show the value.
  const shown = interactive && hover > 0 ? hover : value;

  return (
    <div
      className={`inline-flex items-center ${className ?? ""}`}
      role={interactive ? "radiogroup" : "img"}
      aria-label={value > 0 ? t("rated", { count: value }) : t("unrated")}
      onMouseLeave={interactive ? () => setHover(0) : undefined}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= shown;
        const Star = Icons.rating;
        if (!interactive) {
          return (
            <Star
              key={star}
              size={size}
              className={filled ? starClassName : emptyClassName}
              fill={filled ? "currentColor" : "none"}
            />
          );
        }
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={t("nStars", { count: star })}
            title={t("nStars", { count: star })}
            className="p-0.5 transition-transform hover:scale-110"
            onMouseEnter={() => setHover(star)}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value === star ? 0 : star);
            }}
          >
            <Star
              size={size}
              className={filled ? starClassName : emptyClassName}
              fill={filled ? "currentColor" : "none"}
            />
          </button>
        );
      })}
    </div>
  );
}
