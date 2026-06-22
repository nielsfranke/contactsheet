// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ImageResponse } from "@/lib/types";

/** Just the rendition URLs the source resolver reads — keeps the helpers pure and testable. */
type Renditions = Pick<ImageResponse, "id" | "small_url" | "medium_url" | "thumb_url">;

interface SrcContext {
  /** Watermarking active → route through the signing proxy instead of the static rendition URL. */
  watermarkEnabled: boolean;
  /** Public share token; required for the watermark proxy path. */
  shareToken?: string;
}

/**
 * The URL for one rendition of a lightbox slide. When a watermark is active (public galleries only),
 * the bytes are composited on the fly behind the share-token proxy. Otherwise we serve the static
 * rendition, falling back down the chain (small → medium → thumb) so a slide is never blank while a
 * larger tier is still rendering.
 */
export function variantSrc(im: Renditions, variant: "small" | "medium", ctx: SrcContext): string {
  if (ctx.watermarkEnabled && ctx.shareToken) {
    return `/api/public/g/${ctx.shareToken}/images/${im.id}/${variant}`;
  }
  if (variant === "small") return im.small_url ?? im.medium_url ?? im.thumb_url ?? "";
  return im.medium_url ?? im.thumb_url ?? "";
}

/** The displayed source for a slide: `small` on phone-class viewports, `medium` elsewhere. */
export function photoSrc(im: Renditions, compact: boolean, ctx: SrcContext): string {
  return variantSrc(im, compact ? "small" : "medium", ctx);
}
