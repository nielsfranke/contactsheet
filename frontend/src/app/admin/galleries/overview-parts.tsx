// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useModeLabels } from "@/lib/mode-labels";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { GalleryResponse } from "@/lib/types";
import { GALLERY_DROP_PREFIX, TOPLEVEL_DROP_PREFIX } from "@/components/admin/AdminDnd";
import { CornerDownRight, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
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
import { mosaicCovers, subtreeHasNewActivity, totalImageCount } from "@/lib/gallery-sort";

/**
 * Permanent "move to top level" drop target shown above the overview grid. Always visible (so it's
 * discoverable and reachable even when the grid is full — no reflow, since it never appears/vanishes
 * on drag). Drop a sub-gallery here to un-nest it; highlights on `isOver`. The drag how-to is its
 * tooltip.
 */
export function TopLevelZone() {
  const t = useTranslations("admin.galleries");
  const isTouch = useCoarsePointer();
  const { setNodeRef, isOver } = useDroppable({ id: `${TOPLEVEL_DROP_PREFIX}:overview`, data: { topLevel: true }, disabled: isTouch });
  // Dragging is mouse-only (tiles disable it on touch), so on a phone/tablet the zone is dead weight.
  if (isTouch) return null;
  return (
    <div
      ref={setNodeRef}
      // The how-to lives in the tooltip: a permanent sentence above the grid cost a row on every visit.
      title={t("organizeHint")}
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs transition-colors",
        isOver ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <CornerDownRight size={13} /> {t("dropTopLevel")}
    </div>
  );
}

/**
 * "New" marker for client activity the photographer hasn't opened yet (a folder shows it for any
 * descendant). Achromatic on purpose: the accent stays the page's one primary action, and a dot +
 * word reads without relying on colour.
 */
export function NewActivityMark() {
  const t = useTranslations("admin.galleries");
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground" title={t("newActivityTitle")}>
      <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden />
      {t("newActivity")}
    </span>
  );
}

/**
 * A gallery's cover: its own (uploaded or picked) cover, else — for a folder, when `mosaic` is on —
 * a 1/2/3/4-up mosaic of its sub-galleries' covers, else the name placeholder. `compact` is the
 * thumbnail-sized variant used by list rows (monogram placeholder).
 */
export function GalleryCover({ g, mosaic, compact = false }: { g: GalleryResponse; mosaic: boolean; compact?: boolean }) {
  // alt="": decorative everywhere — the gallery name is the link text next to / below the cover.
  if (g.cover_image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={g.cover_image_url} alt="" className="h-full w-full object-cover" />;
  }
  const urls = mosaic ? mosaicCovers(g) : [];
  if (urls.length === 0) return <CoverPlaceholder name={g.name} compact={compact} />;
  return (
    <div
      className={cn(
        "grid h-full w-full gap-px bg-background",
        urls.length === 1 && "grid-cols-1",
        urls.length === 2 && "grid-cols-2",
        urls.length === 3 && "grid-cols-[2fr_1fr] grid-rows-2",
        urls.length === 4 && "grid-cols-2 grid-rows-2",
      )}
    >
      {urls.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u}
          src={u}
          alt=""
          loading="lazy"
          className={cn("h-full w-full min-h-0 min-w-0 object-cover", urls.length === 3 && i === 0 && "row-span-2")}
        />
      ))}
    </div>
  );
}

/**
 * A photo-first gallery card: full-bleed cover with the title + count on a clean line below.
 * Clicking opens the gallery's detail page. Drag-to-reparent is always on (no Organize mode): the
 * 8px mouse activation distance keeps clicks clicks, and a stray move is one-tap reversible via the
 * reparent Undo toast. Disabled on touch — long-press-drag there is fiddly and the "Move gallery"
 * dialog covers reparenting. A sub-gallery count badge marks containers; it's also a nest drop target.
 */
export function GalleryTile({
  g, tileShape, tileCorners, mosaic, compact = false, dimmed, onOpen, onTogglePin, onRename, onDelete,
}: {
  g: GalleryResponse;
  tileShape: string;
  /** Folders without a cover show their sub-galleries' covers (`overview_mosaic`). */
  mosaic: boolean;
  /** Dense "compact" overview: smaller type, no subtitle / comment count under the tile. */
  compact?: boolean;
  tileCorners: string;
  dimmed: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("admin.galleries");
  const modeLabels = useModeLabels();
  const isTouch = useCoarsePointer();
  const isFolder = g.children.length > 0;
  const countParts: string[] = [];
  if (isFolder) countParts.push(t("galleryCount", { count: g.children.length }));
  const photos = totalImageCount(g);
  if (photos > 0 || countParts.length === 0) countParts.push(t("photoCount", { count: photos }));
  const drag = useDraggable({ id: `${g.id}:tile`, data: { reparent: true, galleryId: g.id, parentId: g.parent_id, name: g.name }, disabled: isTouch });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${g.id}:tile`, data: { galleryId: g.id }, disabled: isTouch });
  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  // drag.attributes is deliberately not spread: dnd-kit would hand the card role="button" +
  // tabIndex, but no KeyboardSensor is configured (dragging is pointer-only) and a div with
  // role="button" doesn't activate on Enter — the stop was dead. The gallery title is a real link
  // instead, so the overview is one keyboard stop per gallery.
  return (
    <div
      ref={setRef}
      {...(isTouch ? {} : drag.listeners)}
      onClick={onOpen}
      className={cn(
        "group text-left cursor-pointer",
        !isTouch && "active:cursor-grabbing",
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
        <GalleryCover g={g} mosaic={mosaic} />
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
            <Icons.subGallery size={11} aria-hidden /> <span className="tabular-nums" aria-hidden>{g.children.length}</span>
            <span className="sr-only">{t("subGalleryCount", { count: g.children.length })}</span>
          </OverlayPill>
        )}
        {/* Mode chip — icon-only at rest; the label (Review / Showcase) expands on hover. */}
        <OverlayPill
          variant="control"
          shape="pill"
          className="group/mode absolute bottom-2 left-2 px-1.5 py-1"
          title={t("modeTitle", { mode: modeLabels[g.mode] })}
        >
          {g.mode === "collaboration" ? <Icons.modeReview size={11} /> : <Icons.modeShowcase size={11} />}
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-medium leading-none opacity-0 transition-all duration-200 group-hover/mode:ml-1 group-hover/mode:max-w-[5rem] group-hover/mode:opacity-100">
            {modeLabels[g.mode]}
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
      <div className={cn("min-w-0", compact ? "mt-1.5" : "mt-2")}>
        <div className="flex items-center gap-1">
          {g.has_password && <Icons.locked size={12} className="text-muted-foreground flex-shrink-0" />}
          <Link
            href={`/admin/galleries/${g.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "min-w-0 truncate rounded font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {g.name}
          </Link>
        </div>
        {g.headline && !compact && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">{g.headline}</p>
        )}
        <div className={cn("flex items-center gap-2 mt-0.5 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          {subtreeHasNewActivity(g) && <NewActivityMark />}
          <span className="truncate">{countParts.join(" · ")}</span>
          {g.comment_count > 0 && !compact && (
            <span className="flex items-center gap-0.5">
              <Icons.comment size={10} aria-hidden /> <span aria-hidden>{g.comment_count}</span>
              <span className="sr-only">{t("commentCount", { count: g.comment_count })}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact row variant of GalleryTile for the phone "list" layout (`overview_mobile_layout`): a
 * small cover, the name + counts, and one kebab holding pin / rename / delete. Same data and
 * callbacks as the tile so the page can swap between the two without re-plumbing. Drag/drop is
 * off on touch (as on the tile); the row stays a nest drop target for a mouse-driven narrow window.
 */
export function GalleryListRow({
  g, tileCorners, mosaic, dimmed, onOpen, onTogglePin, onRename, onDelete,
}: {
  g: GalleryResponse;
  tileCorners: string;
  mosaic: boolean;
  dimmed: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("admin.galleries");
  const modeLabels = useModeLabels();
  const isTouch = useCoarsePointer();
  const isFolder = g.children.length > 0;
  const countParts: string[] = [];
  if (isFolder) countParts.push(t("galleryCount", { count: g.children.length }));
  const photos = totalImageCount(g);
  if (photos > 0 || countParts.length === 0) countParts.push(t("photoCount", { count: photos }));
  const drag = useDraggable({ id: `${g.id}:row`, data: { reparent: true, galleryId: g.id, parentId: g.parent_id, name: g.name }, disabled: isTouch });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${g.id}:row`, data: { galleryId: g.id }, disabled: isTouch });
  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  return (
    <div
      ref={setRef}
      {...(isTouch ? {} : drag.listeners)}
      onClick={onOpen}
      className={cn(
        "group -mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors active:bg-muted/60",
        drop.isOver && "bg-accent ring-2 ring-primary",
        dimmed && "opacity-30",
      )}
    >
      <div className={cn("relative h-14 w-14 shrink-0 overflow-hidden bg-muted", tileCorners)}>
        <GalleryCover g={g} mosaic={mosaic} compact />
        {isFolder && (
          <OverlayPill variant="badge" size="xs" className="absolute bottom-1 right-1 gap-0.5" title={t("subGalleryCount", { count: g.children.length })}>
            <Icons.subGallery size={10} aria-hidden /> <span className="tabular-nums" aria-hidden>{g.children.length}</span>
            <span className="sr-only">{t("subGalleryCount", { count: g.children.length })}</span>
          </OverlayPill>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {g.has_password && <Icons.locked size={12} className="flex-shrink-0 text-muted-foreground" />}
          <Link
            href={`/admin/galleries/${g.id}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate rounded text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {g.name}
          </Link>
          {g.pinned && (
            <Icons.pin size={12} className="flex-shrink-0 -rotate-45 fill-current text-muted-foreground" aria-label={t("pinnedShelf")} />
          )}
        </div>
        {g.headline && <p className="mt-0.5 truncate text-xs text-muted-foreground">{g.headline}</p>}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" title={t("modeTitle", { mode: modeLabels[g.mode] })}>
            {g.mode === "collaboration" ? <Icons.modeReview size={11} aria-hidden /> : <Icons.modeShowcase size={11} aria-hidden />}
            {/* Phones: icon only (narrow row). Desktop list has the room to name the mode. */}
            <span className="sr-only md:not-sr-only">{modeLabels[g.mode]}</span>
          </span>
          {subtreeHasNewActivity(g) && <NewActivityMark />}
          <span className="truncate">{countParts.join(" · ")}</span>
          {g.comment_count > 0 && (
            <span className="flex items-center gap-0.5">
              <Icons.comment size={10} aria-hidden /> <span aria-hidden>{g.comment_count}</span>
              <span className="sr-only">{t("commentCount", { count: g.comment_count })}</span>
            </span>
          )}
        </div>
      </div>
      {/* Row kebab: the tile's hover pills have no hover on a phone, so pin joins rename/delete. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="shrink-0 rounded-md p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          title={t("moreActions")}
          aria-label={t("moreActions")}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onTogglePin(); }}>
            <Icons.pin size={14} className={cn("-rotate-45", g.pinned && "fill-current")} /> {g.pinned ? t("unpinFromTop") : t("pinToTop")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}>
            <Pencil size={14} /> {t("renameAction")}
          </DropdownMenuItem>
          <DropdownMenuItem destructive onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={14} /> {t("deleteAction")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
