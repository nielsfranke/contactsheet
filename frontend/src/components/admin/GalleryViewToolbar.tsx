// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ArrangeState } from "./GalleryAdminSidebar";
import { GalleryToolbar } from "@/components/gallery/GalleryToolbar";

interface Props {
  arrange: ArrangeState;
  setArrange: (next: ArrangeState) => void;
  shownCount: number;
  totalCount: number;
}

/**
 * Admin in-gallery view controls — a thin host wrapper around the shared {@link GalleryToolbar}.
 * Only the positioning differs from the client: it's sticky and bleeds into the page's `p-6`
 * padding (`-mx-6 -mt-6`). Look + behaviour live in the shared component; colors come from the
 * admin theme tokens already in scope on `/admin`.
 *
 * On mobile it sticks below the page's `GalleryUpNav` bar (`top-10`, ≈ that bar's height); at md+
 * the up-nav is hidden so it returns to `top-0`.
 */
export function GalleryViewToolbar({ arrange, setArrange, shownCount, totalCount }: Props) {
  return (
    <GalleryToolbar
      arrange={arrange}
      setArrange={setArrange}
      shownCount={shownCount}
      totalCount={totalCount}
      className="sticky top-10 md:top-0 z-20 -mx-6 -mt-6 px-6 py-2.5"
    />
  );
}
