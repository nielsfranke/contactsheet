// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared thumbnail-grid layout maps, used by both the public PhotoGrid and the admin
// AdminImageGrid so the admin view mirrors exactly what the client sees (WYSIWYG).
import type { LayoutType, SizeType } from "@/lib/types";

// Larger preview size → fewer columns.
export const GRID_COLS: Record<SizeType, string> = {
  small: "grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10",
  medium: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  large: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3",
};

export const GAP: Record<SizeType, string> = { small: "gap-1", medium: "gap-2", large: "gap-4" };

// "Masonry" renders as justified rows (JustifiedGrid): target row height per preview size,
// pixel gap matching the GAP classes above.
export const JUSTIFIED_ROW_HEIGHT: Record<SizeType, number> = { small: 120, medium: 240, large: 420 };

export const GAP_PX: Record<SizeType, number> = { small: 4, medium: 8, large: 16 };

// Above this many tiles, the grids window their rows (only on-screen rows mount). Below it the
// markup is unchanged — small galleries (the common case) pay nothing and behave exactly as before.
export const VIRTUALIZE_THRESHOLD = 150;

// Explicit column counts behind the responsive GRID_COLS classes, by Tailwind breakpoint
// [base, sm≥640, lg≥1024, xl≥1280] — used by the windowed grid, which can't lean on CSS classes.
const GRID_COL_COUNTS: Record<SizeType, [number, number, number, number]> = {
  small: [3, 5, 8, 10],
  medium: [2, 3, 4, 5],
  large: [1, 2, 2, 3],
};

/** Column count for the grid/list layouts at a given container width — mirrors GRID_COLS. */
export function gridColumnCount(layout: LayoutType, size: SizeType, width: number): number {
  if (layout === "list") return width >= 640 ? 2 : 1;
  const [base, sm, lg, xl] = GRID_COL_COUNTS[size];
  if (width >= 1280) return xl;
  if (width >= 1024) return lg;
  if (width >= 640) return sm;
  return base;
}

/** Aspect ratio for layout, with a landscape fallback for images without stored dimensions. */
export function imageAspect(img: { width: number | null; height: number | null }): number {
  return img.width && img.height ? img.width / img.height : 3 / 2;
}

export function cornerRounding(corners: "round" | "square"): string {
  return corners === "square" ? "rounded-none" : "rounded-sm";
}

/** Column classes for the non-masonry (grid / list) layouts. */
export function gridColumns(layout: LayoutType, size: SizeType): string {
  return layout === "list" ? "grid-cols-1 sm:grid-cols-2" : GRID_COLS[size];
}

// Long-edge caps of the generated preview files per high_res mode (mirror backend preview_targets).
const PREVIEW_CAPS = {
  low: { thumb: 300, small: 1024, medium: 1920 },
  high: { thumb: 800, small: 1280, medium: 2560 },
} as const;

interface PreviewSources {
  width: number | null;
  height: number | null;
  thumb_url: string | null;
  small_url: string | null;
  medium_url: string | null;
}

/** srcset over the thumb / small / medium renditions so the browser picks a right-sized source per
 *  rendered width + DPR. Width descriptors are each rendition's actual pixel width (long edge capped,
 *  never upscaled); tiers that don't end up wider than the previous (small originals) are dropped. */
export function previewSrcSet(img: PreviewSources, highRes: boolean): string | undefined {
  const caps = highRes ? PREVIEW_CAPS.high : PREVIEW_CAPS.low;
  const renditionWidth = (cap: number) =>
    img.width && img.height
      ? Math.round(Math.min(1, cap / Math.max(img.width, img.height)) * img.width)
      : cap;
  const entries: string[] = [];
  let lastW = 0;
  for (const [variant, url] of [
    ["thumb", img.thumb_url],
    ["small", img.small_url],
    ["medium", img.medium_url],
  ] as const) {
    if (!url) continue;
    const w = renditionWidth(caps[variant]);
    if (entries.length && w <= lastW) continue;
    entries.push(`${url} ${w}w`);
    lastW = w;
  }
  return entries.length ? entries.join(", ") : undefined;
}

// Approximate rendered tile width for the grid/list layouts, matching the column classes above.
const GRID_SIZES: Record<SizeType, string> = {
  small: "(min-width:1280px) 10vw, (min-width:1024px) 12.5vw, (min-width:640px) 20vw, 33vw",
  medium: "(min-width:1280px) 20vw, (min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw",
  large: "(min-width:1280px) 33vw, (min-width:640px) 50vw, 100vw",
};

/** `sizes` attribute for the non-masonry (grid / list) layouts. */
export function gridSizes(layout: LayoutType, size: SizeType): string {
  return layout === "list" ? "(min-width:640px) 50vw, 100vw" : GRID_SIZES[size];
}
