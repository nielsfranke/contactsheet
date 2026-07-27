// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ImageResponse } from "@/lib/types";
import { withGalleryToken } from "@/lib/gridLayout";

/** Just the rendition URLs the source resolver reads — keeps the helpers pure and testable. */
type Renditions = Pick<ImageResponse, "id" | "small_url" | "medium_url" | "thumb_url">;

interface SrcContext {
  /** Watermarking active → route through the signing proxy instead of the static rendition URL. */
  watermarkEnabled: boolean;
  /** Public share token; required for the watermark proxy path. */
  shareToken?: string;
  /** Gallery JWT for password-protected galleries. Proxy URLs land in <img src>, which can't carry
   *  an Authorization header, so the token rides in `?token=` (same contract as the zip stream). */
  galleryToken?: string;
}


/**
 * The URL for one rendition of a lightbox slide. When a watermark is active (public galleries only),
 * the bytes are composited on the fly behind the share-token proxy. Otherwise we serve the static
 * rendition, falling back down the chain (small → medium → thumb) so a slide is never blank while a
 * larger tier is still rendering.
 */
export function variantSrc(im: Renditions, variant: "small" | "medium", ctx: SrcContext): string {
  if (ctx.watermarkEnabled && ctx.shareToken) {
    return withGalleryToken(`/api/public/g/${ctx.shareToken}/images/${im.id}/${variant}`, ctx.galleryToken);
  }
  // Galleries with downloads disabled get proxy URLs from the serializer too — token those as well.
  const url =
    variant === "small"
      ? im.small_url ?? im.medium_url ?? im.thumb_url ?? ""
      : im.medium_url ?? im.thumb_url ?? "";
  return withGalleryToken(url, ctx.galleryToken);
}

/** The displayed source for a slide: `small` on phone-class viewports, `medium` elsewhere. */
export function photoSrc(im: Renditions, compact: boolean, ctx: SrcContext): string {
  return variantSrc(im, compact ? "small" : "medium", ctx);
}
