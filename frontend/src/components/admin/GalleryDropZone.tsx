// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

/** Droppable id prefix for "move into this gallery" targets (photos now, galleries in phase 2). */
export const GALLERY_DROP_PREFIX = "gallery:";

/**
 * Wraps a gallery target (sub-gallery card, nav folder) so dragged photos can be dropped onto it.
 * Highlights while a drag hovers. Must be rendered inside the admin DndContext.
 *
 * The same gallery can appear as both a canvas card and a sidebar folder, so the droppable id is
 * made unique with `zone`; the actual move target is read from `data.galleryId` on drop.
 */
export function GalleryDropZone({
  galleryId,
  zone,
  children,
  className,
  activeClassName = "ring-2 ring-primary ring-offset-1 ring-offset-background",
}: {
  galleryId: string;
  /** Discriminator so the same gallery can be a target in multiple places (e.g. "card", "nav"). */
  zone: string;
  children: React.ReactNode;
  className?: string;
  activeClassName?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${GALLERY_DROP_PREFIX}${galleryId}:${zone}`,
    data: { galleryId },
  });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && activeClassName)}>
      {children}
    </div>
  );
}
