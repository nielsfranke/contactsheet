// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ImageResponse, LayoutType } from "@/lib/types";
import { GAP, GAP_PX, JUSTIFIED_ROW_HEIGHT, gridColumns, gridSizes, imageAspect } from "@/lib/gridLayout";
import { JustifiedGrid } from "@/components/JustifiedGrid";
import { cn } from "@/lib/utils";
import { AdminTile } from "./admin-grid-tile";
import type { CardProps, DragMode, GridPresentation } from "./admin-grid-types";

/** Renders images in the gallery's own layout (masonry / grid / list). */
export function LayoutGrid({
  images, layout, presentation, dragMode = "none", activeId, ...card
}: {
  images: ImageResponse[];
  layout: LayoutType;
  presentation: GridPresentation;
  dragMode?: DragMode;
  activeId?: string | null;
} & CardProps) {
  const aspectSquare = layout !== "masonry" && layout !== "list";
  const renderTile = (img: ImageResponse, fixedHeight?: number) => {
    const sizes = fixedHeight
      ? `${Math.round(fixedHeight * imageAspect(img))}px`
      : gridSizes(layout, presentation.previewSize);
    if (dragMode === "sortable") {
      return <SortableAdminTile key={img.id} img={img} aspectSquare={aspectSquare} fixedHeight={fixedHeight} sizes={sizes} isDragging={img.id === activeId} {...card} />;
    }
    if (dragMode === "draggable") {
      return <DraggableAdminTile key={img.id} img={img} aspectSquare={aspectSquare} fixedHeight={fixedHeight} sizes={sizes} isDragging={img.id === activeId} {...card} />;
    }
    return <AdminTile key={img.id} img={img} aspectSquare={aspectSquare} fixedHeight={fixedHeight} sizes={sizes} {...card} />;
  };

  if (layout === "masonry") {
    return (
      <JustifiedGrid
        items={images}
        itemKey={(img) => img.id}
        aspect={imageAspect}
        targetRowHeight={JUSTIFIED_ROW_HEIGHT[presentation.previewSize]}
        gap={GAP_PX[presentation.previewSpacing]}
        renderItem={(img, _i, height) => renderTile(img, height)}
      />
    );
  }
  const colClass = gridColumns(layout, presentation.previewSize);
  return (
    <div className={`grid ${colClass} ${GAP[presentation.previewSpacing]}`}>
      {images.map((img) => renderTile(img))}
    </div>
  );
}

function SortableAdminTile({
  img, aspectSquare, fixedHeight, sizes, isDragging, ...card
}: { img: ImageResponse; aspectSquare: boolean; fixedHeight?: number; sizes?: string; isDragging: boolean } & CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: img.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-30")}>
      <AdminTile img={img} aspectSquare={aspectSquare} fixedHeight={fixedHeight} sizes={sizes} dragProps={{ ...attributes, ...listeners }} {...card} />
    </div>
  );
}

// Plain-draggable tile (no reordering) — lets photos be dragged onto sub-gallery cards / nav folders
// in the page DndContext. Used in every non-manual / grouped view.
function DraggableAdminTile({
  img, aspectSquare, fixedHeight, sizes, isDragging, ...card
}: { img: ImageResponse; aspectSquare: boolean; fixedHeight?: number; sizes?: string; isDragging: boolean } & CardProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: img.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}>
      <AdminTile img={img} aspectSquare={aspectSquare} fixedHeight={fixedHeight} sizes={sizes} dragProps={{ ...attributes, ...listeners }} {...card} />
    </div>
  );
}
