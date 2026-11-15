// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useModeLabels } from "@/lib/mode-labels";
import { useAdminDndActive, GALLERY_DROP_PREFIX } from "@/components/admin/AdminDnd";
import { GalleryCover } from "../overview-parts";
import { totalImageCount } from "@/lib/gallery-sort";
import type { ColorFlag, GalleryResponse } from "@/lib/types";
import type { SettingsTab } from "@/components/admin/GallerySettingsModal";
import { Icons } from "@/lib/ui-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eye, Send } from "lucide-react";

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
export function SubGalleryCard({
  child, parentId, mosaic, compact = false, onShare,
}: { child: GalleryResponse; parentId: string; mosaic: boolean; compact?: boolean; onShare: () => void }) {
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
          <GalleryCover g={child} mosaic={mosaic} />
        </div>
        <div className={compact ? "p-1.5" : "p-2"}>
          <p className={cn("font-medium text-foreground truncate", compact ? "text-xs" : "text-sm")}>{child.name}</p>
          <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{t("imagesCount", { count: totalImageCount(child) })}</p>
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

/**
 * Row variant of SubGalleryCard for the "list" layout (`overview_mobile_layout` / `overview_layout`). Same
 * drag source / drop target wiring; the share button is always visible (no hover on touch).
 */
export function SubGalleryRow({
  child, parentId, mosaic, onShare,
}: { child: GalleryResponse; parentId: string; mosaic: boolean; onShare: () => void }) {
  const t = useTranslations("admin.detail");
  const drag = useDraggable({ id: `${child.id}:row`, data: { reparent: true, galleryId: child.id, parentId, name: child.name } });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${child.id}:row`, data: { galleryId: child.id } });
  const active = useAdminDndActive();
  const dimmed = active?.kind === "gallery" && active.galleryId === child.id;
  const setRef = (el: HTMLElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  return (
    <div
      ref={setRef}
      {...drag.listeners}
      className={cn(
        "-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors active:bg-muted/60",
        dimmed && "opacity-30",
        drop.isOver && "bg-accent ring-2 ring-primary",
      )}
    >
      <Link href={`/admin/galleries/${child.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
          <GalleryCover g={child} mosaic={mosaic} compact />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{child.name}</p>
          <p className="text-xs text-muted-foreground">{t("imagesCount", { count: totalImageCount(child) })}</p>
        </div>
      </Link>
      <button
        onClick={onShare}
        title={t("shareLink")}
        aria-label={t("shareLink")}
        className="shrink-0 rounded-md p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Send size={14} />
      </button>
    </div>
  );
}

/**
 * The gallery page's own heading: name (+ subtitle) and the state a photographer checks before
 * sending a link — mode, password, expiry — as chips that open the setting behind them, plus
 * labelled Preview / Share actions. The sidebar carries the same name for navigation; this is the
 * page title (and the only place the current gallery is named on a phone, where the shell's top
 * bar shows the parent).
 */
export function GalleryPageHeader({
  gallery, onSettings, onPreview, onShare, extra,
}: {
  gallery: GalleryResponse;
  onSettings: (tab: SettingsTab) => void;
  onPreview: () => void;
  onShare: () => void;
  /** Extra chips after the state chips (e.g. review progress). */
  extra?: React.ReactNode;
}) {
  const t = useTranslations("admin.detail");
  const modeLabels = useModeLabels();
  const tSide = useTranslations("admin.sidebar");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const expires = gallery.expires_at ? new Date(gallery.expires_at) : null;
  const expired = !!expires && expires.getTime() <= now.getTime();
  const chip =
    "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:border-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const ModeIcon = gallery.mode === "collaboration" ? Icons.modeReview : Icons.modeShowcase;
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-xl font-semibold leading-tight text-foreground text-balance break-words">{gallery.name}</h1>
        {gallery.headline && <p className="text-sm text-muted-foreground text-pretty">{gallery.headline}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={chip} onClick={() => onSettings("general")} title={t("chipModeTitle")}>
            <ModeIcon size={12} aria-hidden /> {modeLabels[gallery.mode]}
          </button>
          {gallery.has_password && (
            <button type="button" className={chip} onClick={() => onSettings("security")} title={t("chipPasswordTitle")}>
              <Icons.locked size={12} aria-hidden /> {t("chipPassword")}
            </button>
          )}
          {expires && (
            <button
              type="button"
              className={cn(chip, expired && "border-destructive/40 text-destructive hover:text-destructive")}
              onClick={() => onSettings("security")}
              title={t("chipExpiryTitle")}
            >
              <Icons.expires size={12} aria-hidden />
              {t(expired ? "chipExpired" : "chipExpires", { date: format.dateTime(expires, { dateStyle: "medium" }) })}
            </button>
          )}
          {extra}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye size={14} className="mr-1.5" /> {t("preview")}
        </Button>
        <Button variant="outline" size="sm" onClick={onShare}>
          <Send size={14} className="mr-1.5" /> {tSide("share")}
        </Button>
      </div>
    </header>
  );
}
