// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { Folder } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

// Keep the drag overlay centered on the cursor (like @dnd-kit/modifiers' snapCenterToCursor, which
// isn't installed). Uses the overlay's own size so a small chip dragged from a large card still
// sits under the pointer.
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, overlayNodeRect, transform }) => {
  const rect = overlayNodeRect ?? draggingNodeRect;
  if (rect && draggingNodeRect && activatorEvent) {
    const coords = getEventCoordinates(activatorEvent);
    if (!coords) return transform;
    return {
      ...transform,
      x: transform.x + (coords.x - draggingNodeRect.left) - rect.width / 2,
      y: transform.y + (coords.y - draggingNodeRect.top) - rect.height / 2,
    };
  }
  return transform;
};

// A single DndContext lives in the admin layout so it spans the portalled gallery sidebar, the
// far-left nav tree, and the page content. Gallery reparenting (drag a gallery onto another) is
// owned here so it works on every admin page; pages register only their image-move/reorder handler
// and image drag overlay.
//
// Drop zones use ids prefixed `gallery:` (move into `data.galleryId`) or `topLevel` (un-nest).
// Gallery drag sources set `data.reparent` + `galleryId`/`parentId`/`name`. Image drags have no
// special data (their id is the image id).
export const GALLERY_DROP_PREFIX = "gallery:";
export const TOPLEVEL_DROP_PREFIX = "topLevel";

export interface AdminDndConfig {
  /** Page handler for non-gallery drags (image move / reorder). */
  onDragEnd?: (e: DragEndEvent) => void;
  /** Overlay for image drags; gallery drags get a built-in chip. */
  renderOverlay?: (activeId: string) => ReactNode;
}

export interface ActiveDrag {
  id: string;
  kind: "image" | "gallery";
  galleryId?: string;
  name?: string;
}

interface DndContextValue {
  register: (c: AdminDndConfig | null) => void;
  active: ActiveDrag | null;
}

const Ctx = createContext<DndContextValue>({ register: () => {}, active: null });

/** Returns a setter to register (or clear, with `null`) the page's image DnD handlers. */
export function useAdminDndRegister() {
  return useContext(Ctx).register;
}
/** The drag currently in progress (for dimming sources / building overlays). */
export function useAdminDndActive() {
  return useContext(Ctx).active;
}

// Prefer a drop zone under the pointer; for image drags fall back to the closest tile (reorder);
// a gallery drag with no zone under the pointer resolves to nothing.
const isGalleryZone = (id: string | number) => {
  const s = String(id);
  return s.startsWith(GALLERY_DROP_PREFIX) || s.startsWith(TOPLEVEL_DROP_PREFIX);
};
const collision: CollisionDetection = (args) => {
  // A move onto a gallery only happens when the pointer is actually inside that zone (intentional
  // drop onto a sub-gallery card / nav folder). A specific gallery card wins over the page-wide
  // "top level" zone, so dropping onto a card nests and dropping on empty canvas un-nests.
  const hits = pointerWithin(args).filter((h) => isGalleryZone(h.id));
  const card = hits.find((h) => String(h.id).startsWith(GALLERY_DROP_PREFIX));
  if (card) return [card];
  if (hits.length) return [hits[0]];
  if (args.active.data.current?.reparent) return [];
  // Image-drag fallback = reorder: resolve only to sibling image tiles, never a gallery zone.
  // Otherwise closestCenter snaps a photo dropped in empty space to the nearest gallery folder/card
  // and silently moves it out of the gallery (in non-manual sort, tiles aren't droppable, so the
  // only droppables left are gallery zones).
  const tiles = args.droppableContainers.filter((c) => !isGalleryZone(c.id));
  return closestCenter({ ...args, droppableContainers: tiles });
};

export function AdminDndProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const t = useTranslations("admin.dnd");
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [cfg, setCfg] = useState<AdminDndConfig | null>(null);
  // Mouse drags start after an 8px move (instant feel). Touch drags require a 250ms press-and-hold
  // (then >8px movement cancels the pickup) so a normal scroll swipe never grabs a photo by mistake.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const moveMutation = useMutation({
    mutationFn: ({ id, targetParentId }: { id: string; targetParentId: string | null }) =>
      api.galleries.move(id, targetParentId),
    onError: (err: Error) => toast.error(err.message),
  });

  function reparent(galleryId: string, target: string | null, origParentId: string | null, name?: string) {
    if (target === galleryId || target === origParentId) return; // self / no-op
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      qc.invalidateQueries({ queryKey: ["gallery"] });
    };
    moveMutation.mutate(
      { id: galleryId, targetParentId: target },
      {
        onSuccess: () => {
          refresh();
          const display = name ?? t("fallbackName");
          // Neutral toast (matches the pin/undo toast), top-center + longer life so the Undo is
          // noticed near where the drag happened — not the green "success" style, not bottom-right.
          toast(target ? t("movedInto", { name: display }) : t("movedToTop", { name: display }), {
            position: "top-center",
            duration: 8000,
            action: { label: t("undo"), onClick: () => api.galleries.move(galleryId, origParentId).then(refresh) },
          });
        },
      },
    );
  }

  function handleDragStart(e: DragStartEvent) {
    const a = e.active.data.current;
    setActive({
      id: String(e.active.id),
      kind: a?.reparent ? "gallery" : "image",
      galleryId: a?.galleryId as string | undefined,
      name: a?.name as string | undefined,
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    setActive(null);
    const a = e.active.data.current;
    if (a?.reparent) {
      if (!e.over) return;
      const o = e.over.data.current;
      const target = o?.topLevel ? null : (o?.galleryId as string | undefined);
      if (target === undefined) return; // dropped on a non-gallery zone
      reparent(String(a.galleryId), target, (a.parentId as string | null) ?? null, a.name as string | undefined);
      return;
    }
    cfg?.onDragEnd?.(e);
  }

  return (
    <Ctx.Provider value={{ register: setCfg, active }}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
          {active?.kind === "gallery" ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-1.5 text-sm font-medium text-foreground shadow-2xl cursor-grabbing">
              <Folder size={15} className="text-muted-foreground" />
              <span className="truncate max-w-[12rem]">{active.name ?? t("fallbackName")}</span>
            </div>
          ) : active ? (
            cfg?.renderOverlay?.(active.id) ?? null
          ) : null}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  );
}
