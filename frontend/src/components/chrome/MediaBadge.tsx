// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ImageResponse } from "@/lib/types";
import { Icons } from "@/lib/ui-icons";
import { OverlayPill } from "@/components/chrome/OverlayPill";
import { cn } from "@/lib/utils";

/**
 * The unified annotation + plain-comment count badges for a photo tile, drawn identically on the
 * admin and client grids (was two drifting implementations). Encapsulates the
 * `comment_count − annotation_count` = "plain comments" math.
 *
 * Canonical placement: bottom-right (the admin grid moved here from top-left, which collided with the
 * selection checkbox). Position with the `className` on the wrapper at the call site.
 */
export function MediaBadge({ img, className }: { img: ImageResponse; className?: string }) {
  const annotations = img.annotation_count;
  const comments = img.comment_count - img.annotation_count;
  if (annotations <= 0 && comments <= 0) return null;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {annotations > 0 && (
        <OverlayPill variant="badge" size="xs">
          <Icons.annotation size={10} /> {annotations}
        </OverlayPill>
      )}
      {comments > 0 && (
        <OverlayPill variant="badge" size="xs">
          <Icons.comment size={10} /> {comments}
        </OverlayPill>
      )}
    </div>
  );
}
