// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useAdminDndActive, GALLERY_DROP_PREFIX } from "@/components/admin/AdminDnd";
import { CoverPlaceholder } from "@/components/chrome/CoverPlaceholder";
import type { ColorFlag, GalleryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Send } from "lucide-react";

export const FLAG_GROUP_ORDER: ColorFlag[] = ["green", "red", "yellow", "blue", "none"];
// Rating group buckets, highest first, unrated last.
export const RATING_GROUP_ORDER: number[] = [5, 4, 3, 2, 1, 0];

// Find a gallery's children in the cached tree (api.galleries.get returns children: []).
export function findChildren(tree: GalleryResponse[], id: string): GalleryResponse[] | null {
  for (const g of tree) {
    if (g.id === id) return g.children;
    const inChild = findChildren(g.children, id);
    if (inChild) return inChild;
  }
  return null;
}

// Find the parent of a gallery in the cached tree.
export function findParent(tree: GalleryResponse[], id: string): GalleryResponse | null {
  for (const g of tree) {
    if (g.children.some((c) => c.id === id)) return g;
    const inChild = findParent(g.children, id);
    if (inChild) return inChild;
  }
  return null;
}

// Renders the per-gallery sidebar into the admin layout's sidebar slot,
// so gallery pages keep a single two-column layout.
export function SidebarPortal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The slot div is only in the DOM after the layout's first commit, so it must be
    // looked up post-commit; the one extra render is inherent to the portal pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.getElementById("gallery-admin-sidebar-slot"));
  }, []);
  return target ? createPortal(children, target) : null;
}

/**
 * Sub-gallery card on the detail page: a gallery drag source (to reparent) AND a drop target — for
 * photos (move into it) and for galleries (nest into it). Drag/drop handled by AdminDndProvider.
 */
export function SubGalleryCard({ child, parentId, onShare }: { child: GalleryResponse; parentId: string; onShare: () => void }) {
  const t = useTranslations("admin.detail");
  const drag = useDraggable({ id: `${child.id}:card`, data: { reparent: true, galleryId: child.id, parentId, name: child.name } });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${child.id}:card`, data: { galleryId: child.id } });
  const active = useAdminDndActive();
  const dimmed = active?.kind === "gallery" && active.galleryId === child.id;
  const setRef = (el: HTMLElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  // drag.attributes is deliberately not spread: it would add a second, dead tab stop in front of
  // the card's real link (dnd-kit announces a draggable as a button, but no KeyboardSensor is
  // configured — dragging is pointer-only).
  return (
    <div
      ref={setRef}
      {...drag.listeners}
      className={cn(
        "relative group/subcard rounded-lg border overflow-hidden bg-card/40 transition-colors cursor-grab active:cursor-grabbing",
        dimmed && "opacity-30",
        drop.isOver ? "border-primary ring-2 ring-primary" : "border-border hover:border-muted-foreground",
      )}
    >
      <Link href={`/admin/galleries/${child.id}`} className="block">
        <div className="aspect-video bg-muted">
          {child.cover_image_url ? (
            // alt="": the cover is decorative — the gallery name is the link text right below it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={child.cover_image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <CoverPlaceholder name={child.name} />
          )}
        </div>
        <div className="p-2">
          <p className="text-sm font-medium text-foreground truncate">{child.name}</p>
          <p className="text-xs text-muted-foreground">{t("imagesCount", { count: child.image_count })}</p>
        </div>
      </Link>
      <button
        onClick={onShare}
        title={t("shareLink")}
        aria-label={t("shareLink")}
        className="absolute top-2 right-2 rounded bg-black/50 p-1 text-white opacity-0 outline-none transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white group-hover/subcard:opacity-100"
      >
        <Send size={12} />
      </button>
    </div>
  );
}
