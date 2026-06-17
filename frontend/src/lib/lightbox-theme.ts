// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LightboxBackdrop } from "@/lib/types";

/**
 * Single source of truth for lightbox chrome tones. The lightbox backdrop is a per-instance setting
 * (`dimmed`/`black`/`white`/`transparent`) independent of the gallery's bright/dark tone, so all
 * chrome — toolbars, EXIF/IPTC, the comment panel, the annotation note popover — must derive its
 * colors from here rather than hard-coding `zinc-*`. `white`/`transparent` are the light backdrops
 * (dark text); `black`/`dimmed` keep light-on-dark chrome.
 *
 * Design rule: lightbox chrome takes its tone from `lightboxTones(backdrop)`. Never hard-code a dark
 * (or light) value in a sub-panel — pass the `tones` object down and pick from it.
 */
export interface LightboxTones {
  /** True on the light backdrops (`white` / `transparent`). */
  light: boolean;
  /** Root backdrop fill. */
  surface: string;
  /** Secondary text (labels, counts). */
  muted: string;
  /** Primary text (active controls, author names). */
  strong: string;
  hoverStrong: string;
  hoverBg: string;
  /** Divider / border tone. */
  borderTone: string;
  /** Faintest text (timestamps, filename, empty states). */
  faint: string;
  /** Translucent chip fill (e.g. keyword pills). */
  chipBg: string;
  /** Floating panel / popover surface (border + bg). */
  panel: string;
  /** Comment body text. */
  body: string;
  /** Hovered comment-row highlight. */
  rowHot: string;
  /** Form field (input / textarea): bg + border + text + placeholder. */
  field: string;
}

export function lightboxTones(backdrop: LightboxBackdrop): LightboxTones {
  const light = backdrop === "white" || backdrop === "transparent";
  const surface =
    backdrop === "white" ? "bg-white"
    : backdrop === "black" ? "bg-black"
    : backdrop === "transparent" ? "bg-white/95"
    : "bg-black/95";
  return {
    light,
    surface,
    muted: light ? "text-zinc-500" : "text-zinc-400",
    strong: light ? "text-zinc-900" : "text-zinc-100",
    hoverStrong: light ? "hover:text-zinc-900" : "hover:text-zinc-100",
    hoverBg: light ? "hover:bg-black/10" : "hover:bg-white/10",
    borderTone: light ? "border-zinc-200" : "border-zinc-800",
    faint: light ? "text-zinc-400" : "text-zinc-600",
    chipBg: light ? "bg-black/5" : "bg-white/10",
    panel: light ? "border-zinc-200 bg-white" : "border-zinc-700 bg-zinc-900",
    body: light ? "text-zinc-700" : "text-zinc-400",
    rowHot: light ? "bg-black/5" : "bg-zinc-800",
    field: light
      ? "bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400"
      : "bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500",
  };
}
