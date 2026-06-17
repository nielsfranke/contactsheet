// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared admin "shelf": a sticky header band that bleeds into the page's padding, with a
 * bottom border, blurred background, and a fixed height on md+. It is the single source of the
 * band geometry — both the in-gallery view-controls toolbar ({@link GalleryToolbar}) and the
 * galleries overview header sit in it, so the two screens share one continuous anchor across the
 * top even though the controls inside the band differ per page. Styled with semantic theme
 * tokens, so it renders against the admin theme on `/admin` and the per-gallery tone inside a
 * `.gallery-scope` on the public page.
 */
export function ToolbarBand({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/95 backdrop-blur md:h-16 md:py-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
