// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { GalleryResponse } from "@/lib/types";
import { MODE_LABELS } from "@/lib/types";
import { GALLERY_DROP_PREFIX, TOPLEVEL_DROP_PREFIX } from "@/components/admin/AdminDnd";
import { CornerDownRight, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Icons } from "@/lib/ui-icons";
import { OverlayPill, overlayPillVariants } from "@/components/chrome/OverlayPill";
import { CoverPlaceholder } from "@/components/chrome/CoverPlaceholder";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Drop strip that un-nests a gallery to the top level. */
export function TopLevelZone() {
  const t = useTranslations("admin.galleries");
  const { setNodeRef, isOver } = useDroppable({ id: `${TOPLEVEL_DROP_PREFIX}:overview`, data: { topLevel: true } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs transition-colors",
        isOver ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <CornerDownRight size={13} /> {t("dropTopLevel")}
    </div>
  );
}

/**
 * A photo-first gallery card: full-bleed cover with the title + count on a clean line below.
 * Clicking the card opens the gallery's detail page (its sub-galleries + photos) — one consistent
 * action for every gallery. A sub-gallery count badge marks containers. In organize mode it's a
 * gallery drag source and a nest drop target.
 */
export function GalleryTile({
  g, organize, tileShape, tileCorners, dimmed, onOpen, onTogglePin, onRename, onDelete,
}: {
  g: GalleryResponse;
  organize: boolean;
  tileShape: string;
  tileCorners: string;
  dimmed: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("admin.galleries");
  // A folder = a gallery that contains sub-galleries → clicking browses in. A leaf (no children)
  // opens directly. We make folders look like a stack so the click is predictable from the card.
  const isFolder = g.children.length > 0;
  const countParts: string[] = [];
  if (isFolder) countParts.push(t("galleryCount", { count: g.children.length }));
  if (g.image_count > 0 || countParts.length === 0) countParts.push(t("photoCount", { count: g.image_count }));
  const drag = useDraggable({ id: `${g.id}:tile`, data: { reparent: true, galleryId: g.id, parentId: g.parent_id, name: g.name }, disabled: !organize });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${g.id}:tile`, data: { galleryId: g.id }, disabled: !organize });
  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  return (
    <div
      ref={setRef}
      {...(organize ? drag.listeners : {})}
      {...(organize ? drag.attributes : {})}
      onClick={onOpen}
      className={cn(
        "group text-left",
        organize ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dimmed && "opacity-30",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden bg-muted transition-all",
          tileShape,
          tileCorners,
          drop.isOver ? "ring-2 ring-primary" : "group-hover:ring-2 group-hover:ring-ring",
        )}
      >
        {g.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.cover_image_url} alt={g.name} className="w-full h-full object-cover" />
        ) : (
          <CoverPlaceholder name={g.name} />
        )}
        {/* Pin toggle (top-left). Shows on hover, and stays visible when pinned (gold) or on
            touch (no hover). */}
        <OverlayPill
          as="button"
          variant="control"
          size="sm"
          shape="iconPill"
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          title={g.pinned ? t("unpinFromTop") : t("pinToTop")}
          aria-label={g.pinned ? t("unpinGallery") : t("pinGallery")}
          aria-pressed={g.pinned}
          className={cn(
            "absolute top-2 left-2 focus-visible:opacity-100",
            g.pinned ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
          )}
        >
          <Icons.pin size={14} className={cn("-rotate-45", g.pinned && "fill-current")} />
        </OverlayPill>
        {/* Sub-gallery count (bottom-right) — the folder indicator: this gallery contains others. */}
        {isFolder && (
          <OverlayPill
            variant="badge"
            size="xs"
            className="absolute bottom-2 right-2 gap-1"
            title={t("subGalleryCount", { count: g.children.length })}
          >
            <Icons.subGallery size={11} /> <span className="tabular-nums">{g.children.length}</span>
          </OverlayPill>
        )}
        {/* Mode chip — icon-only at rest; the label (Review / Showcase) expands on hover. */}
        <OverlayPill
          variant="control"
          shape="pill"
          className="group/mode absolute bottom-2 left-2 px-1.5 py-1"
          title={t("modeTitle", { mode: MODE_LABELS[g.mode] })}
        >
          {g.mode === "collaboration" ? <Icons.modeReview size={11} /> : <Icons.modeShowcase size={11} />}
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-medium leading-none opacity-0 transition-all duration-200 group-hover/mode:ml-1 group-hover/mode:max-w-[5rem] group-hover/mode:opacity-100">
            {MODE_LABELS[g.mode]}
          </span>
        </OverlayPill>
        {/* Kebab → rename / delete. Base UI portals + positions the menu, escaping overflow:hidden. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              overlayPillVariants({ variant: "control", size: "sm", shape: "iconPill" }),
              "absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100",
            )}
            title={t("moreActions")}
            aria-label={t("moreActions")}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* stopPropagation: the menu is portalled in the DOM but is still a React child of the
                card's onClick={onOpen}, so item clicks bubble up the React tree and would navigate
                into the gallery instead of opening rename/delete. */}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}>
              <Pencil size={14} /> {t("renameAction")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Trash2 size={14} /> {t("deleteAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 min-w-0">
        <div className="flex items-center gap-1">
          {g.has_password && <Icons.locked size={12} className="text-muted-foreground flex-shrink-0" />}
          <span className="text-sm font-medium text-foreground truncate">{g.name}</span>
        </div>
        {g.headline && (
          <p className="mt-0.5 text-xs text-muted-foreground/80 truncate">{g.headline}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{countParts.join(" · ")}</span>
          {g.comment_count > 0 && (
            <span className="flex items-center gap-0.5">
              <Icons.comment size={10} /> {g.comment_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
