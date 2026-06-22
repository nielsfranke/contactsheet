// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared types for the admin image grid (orchestrator + layout + tile). Kept in one module so the
// layout and tile components don't import back through the orchestrator (avoids a cycle).

import type { CornersType, ImageResponse, RatingMode, SizeType } from "@/lib/types";
import type { LightboxIntent } from "@/store/lightbox";

export interface ImageGroup {
  key: string;
  label: string;
  images: ImageResponse[];
}

export interface GridPresentation {
  previewSize: SizeType;
  previewSpacing: SizeType;
  previewCorners: CornersType;
}

export const DEFAULT_PRESENTATION: GridPresentation = {
  previewSize: "medium",
  previewSpacing: "medium",
  previewCorners: "round",
};

export type DragMode = "none" | "sortable" | "draggable";

export interface CardProps {
  galleryId: string;
  onDelete: (img: ImageResponse) => void;
  deleting: boolean;
  onOpen?: (img: ImageResponse, intent?: LightboxIntent) => void;
  rounded: string;
  highRes: boolean;
  /** Instance rating style — flag dots vs. 1–5 stars. */
  ratingMode: RatingMode;
  onSetHeaderImage?: (img: ImageResponse) => void;
  onSetCoverImage?: (img: ImageResponse) => void;
  onRenameImage?: (img: ImageResponse) => void;
  onMoveImage?: (img: ImageResponse) => void;
  // Present only while a collection is filtered active → kebab "Remove from collection".
  onRemoveFromCollection?: (img: ImageResponse) => void;
  // Collections selection mode (drag is disabled by the page while this is on).
  selectionMode?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string) => void;
  onRangeSelect?: (id: string) => void;
}
