// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ArrangeState } from "./GalleryAdminSidebar";
import type { RatingMode } from "@/lib/types";
import { GalleryToolbar, type ToolbarContentSearch } from "@/components/gallery/GalleryToolbar";

interface Props {
  arrange: ArrangeState;
  setArrange: (next: ArrangeState) => void;
  captureSortAvailable: boolean;
  shownCount: number;
  totalCount: number;
  /** Instance rating style — flags, stars, or both. */
  ratingMode: RatingMode;
  /** Semantic content search — present only when the instance has the feature enabled. */
  search?: ToolbarContentSearch;
}

/**
 * Admin in-gallery view controls — a thin host wrapper around the shared {@link GalleryToolbar}.
 * Only the positioning differs from the client: it's sticky and bleeds into the page's `p-6`
 * padding (`-mx-6 -mt-6`). Look + behaviour live in the shared component; colors come from the
 * admin theme tokens already in scope on `/admin`.
 *
 * It sticks to the top of the scroll area (`top-0`). The mobile "go up" affordance now lives in the
 * admin shell's top bar (not a separate in-page up-nav row), so there's no bar height to offset.
 */
export function GalleryViewToolbar({ arrange, setArrange, captureSortAvailable, shownCount, totalCount, ratingMode, search }: Props) {
  return (
    <GalleryToolbar
      arrange={arrange}
      setArrange={setArrange}
      captureSortAvailable={captureSortAvailable}
      shownCount={shownCount}
      totalCount={totalCount}
      features={{ colorFlags: true, comments: true, ratingMode }}
      search={search}
      className="sticky top-0 z-20 -mx-6 -mt-6 px-6 py-2.5"
    />
  );
}
