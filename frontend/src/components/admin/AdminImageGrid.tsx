// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { api } from "@/lib/api";
import type { ImageResponse, LayoutType } from "@/lib/types";
import type { LightboxIntent } from "@/store/lightbox";
import { cornerRounding } from "@/lib/gridLayout";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { LayoutGrid } from "./admin-grid-layout";
import { DEFAULT_PRESENTATION, type DragMode, type GridPresentation, type ImageGroup } from "./admin-grid-types";

// Re-exported so existing consumers keep importing these from AdminImageGrid.
export type { ImageGroup, GridPresentation } from "./admin-grid-types";

interface Props {
  images: ImageResponse[];
  galleryId: string;
  onRefetch: () => void;
  /** When provided, render labelled sections instead of one flat grid. */
  groups?: ImageGroup[];
  emptyMessage?: string;
  /** Enable drag-to-reorder (only when sort=manual and no grouping). */
  draggable?: boolean;
  /** Make tiles draggable for move-to-gallery DnD (context/overlay live on the page). */
  dragEnabled?: boolean;
  /** Id of the tile currently being dragged (from the page DndContext), to dim its source. */
  activeId?: string | null;
  onOpen?: (img: ImageResponse, intent?: LightboxIntent) => void;
  /** The gallery's own layout so the admin grid mirrors what the client sees (WYSIWYG). */
  layout?: LayoutType;
  presentation?: GridPresentation;
  /** Callbacks from the detail page for per-image actions. */
  onSetHeaderImage?: (img: ImageResponse) => void;
  onSetCoverImage?: (img: ImageResponse) => void;
  onRenameImage?: (img: ImageResponse) => void;
  onMoveImage?: (img: ImageResponse) => void;
  onRemoveFromCollection?: (img: ImageResponse) => void;
  // Collections selection mode (drag is disabled by the page while this is on).
  selectionMode?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string) => void;
  onRangeSelect?: (id: string) => void;
}

export function AdminImageGrid({
  images, galleryId, onRefetch, groups, emptyMessage, draggable, dragEnabled, activeId = null, onOpen,
  layout = "grid", presentation = DEFAULT_PRESENTATION,
  onSetHeaderImage, onSetCoverImage, onRenameImage, onMoveImage, onRemoveFromCollection,
  selectionMode, isSelected, onToggleSelect, onRangeSelect,
}: Props) {
  const t = useTranslations("admin.imageGrid");
  const qc = useQueryClient();

  // Instance-wide setting; when off, tiles stick to the thumb rendition (no srcset).
  const { data: appSettings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });
  const highRes = appSettings?.high_res_previews ?? true;

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => api.images.delete(imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery-images", galleryId] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      onRefetch();
      toast.success(t("deleted"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onDelete = (img: ImageResponse) => {
    if (confirm(t("confirmDelete", { name: img.original_filename }))) deleteMutation.mutate(img.id);
  };
  const deleting = deleteMutation.isPending;

  const rounded = cornerRounding(presentation.previewCorners);
  // Drag-to-reorder needs uniform tiles, so reorder mode is always a square grid; every other
  // view mirrors the gallery's own layout/preview settings.
  const cardProps = { galleryId, onDelete, deleting, onOpen, rounded, highRes, onSetHeaderImage, onSetCoverImage, onRenameImage, onMoveImage, onRemoveFromCollection, selectionMode, isSelected, onToggleSelect, onRangeSelect };

  // Reorder (sortable, square grid) only when sort=manual; otherwise tiles are plain-draggable for
  // move-to-gallery DnD. Both run inside the page-level DndContext.
  const dragMode: DragMode = !dragEnabled ? "none" : draggable && !groups ? "sortable" : "draggable";

  if (groups) {
    if (groups.length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyMessage ?? t("emptyFiltered")}</p>;
    }
    return (
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              {g.label} <span className="text-muted-foreground/60">({g.images.length})</span>
            </h3>
            <LayoutGrid images={g.images} layout={layout} presentation={presentation} dragMode={dragMode === "sortable" ? "draggable" : dragMode} activeId={activeId} {...cardProps} />
          </section>
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage ?? t("emptyNone")}</p>;
  }

  // Sortable (reorder) mode needs a SortableContext; plain-draggable / none render the grid directly.
  // The enclosing DndContext + DragOverlay live on the gallery detail page.
  if (dragMode === "sortable") {
    return (
      <SortableContext items={images.map((img) => img.id)} strategy={rectSortingStrategy}>
        <LayoutGrid images={images} layout={layout} presentation={presentation} dragMode="sortable" activeId={activeId} {...cardProps} />
      </SortableContext>
    );
  }

  return <LayoutGrid images={images} layout={layout} presentation={presentation} dragMode={dragMode} activeId={activeId} {...cardProps} />;
}
