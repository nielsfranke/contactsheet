// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColorFlag, Collection, GalleryResponse } from "@/lib/types";
import { GalleryDropZone } from "@/components/admin/GalleryDropZone";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Settings, Eye, Send, UploadCloud, Download, MoreVertical,
  Plus, CheckSquare, Trash2, Activity, Vote,
  Folder, FolderOpen, Pencil, Eraser, Image as ImageIcon, Frame, Layers, X, Copy, FolderPlus, FolderInput,
} from "lucide-react";

export type SortKey = "manual" | "filename" | "date" | "captured" | "rating";
export type GroupKey = "none" | "flag" | "rating";

export interface ArrangeState {
  filterName: string;
  flagFilters: Set<ColorFlag>;
  /** Stars mode: filter to photos with these exact ratings (0 = unrated). */
  ratingFilters: Set<number>;
  commentsOnly: boolean;
  sortKey: SortKey;
  sortAsc: boolean;
  groupKey: GroupKey;
}

interface Props {
  gallery: GalleryResponse;
  parentGallery?: GalleryResponse | null;
  subGalleries?: GalleryResponse[];
  downloadCount: number;
  onSettings: () => void;
  onPreview: () => void;
  onShare: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onCopyFilenames: () => void;
  onRename: () => void;
  onMoveGallery: () => void;
  onEmpty: () => void;
  onSetHeaderImage: () => void;
  onSetCoverImage: () => void;
  onActivity: () => void;
  onVoting: () => void;
  onDelete: () => void;
  onCreateSub?: () => void;
  arrange: ArrangeState;
  // Collections
  collections?: Collection[];
  selectionMode?: boolean;
  selectedCount?: number;
  onToggleSelectionMode?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onSaveSelection?: () => void;
  onSaveFilter?: () => void;
  activeCollectionId?: string | null;
  onFilterCollection?: (id: string | null) => void;
  onDownloadCollection?: (c: Collection) => void;
  onDeleteCollection?: (c: Collection) => void;
  onRenameCollection?: (c: Collection) => void;
  onAddSelectionToCollection?: () => void;
  onRenameSelection?: () => void;
  onMoveSelection?: () => void;
  onDeleteSelection?: () => void;
  // Create / copy / move images into a gallery (collection / filter / selection sources)
  onCreateGalleryFromCollection?: (c: Collection) => void;
  onCreateGalleryFromFilter?: () => void;
  onCreateGalleryFromSelection?: () => void;
}

export function GalleryAdminSidebar({
  gallery, parentGallery, subGalleries = [], downloadCount,
  onSettings, onPreview, onShare, onUpload, onDownload, onCopyFilenames,
  onRename, onMoveGallery, onEmpty, onSetHeaderImage, onSetCoverImage,
  onActivity, onVoting, onDelete, onCreateSub, arrange,
  collections = [], selectionMode = false, selectedCount = 0,
  onToggleSelectionMode, onSelectAll, onClearSelection, onSaveSelection, onSaveFilter,
  activeCollectionId = null, onFilterCollection, onDownloadCollection, onDeleteCollection,
  onRenameCollection, onAddSelectionToCollection, onRenameSelection, onMoveSelection, onDeleteSelection,
  onCreateGalleryFromCollection, onCreateGalleryFromFilter, onCreateGalleryFromSelection,
}: Props) {
  const t = useTranslations("admin.sidebar");
  const filterActive =
    arrange.filterName.trim() !== "" || arrange.flagFilters.size > 0 || arrange.commentsOnly;
  const iconBtn = "p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded";

  return (
    <div className="px-4 py-3 space-y-6">
      {/* Where you are: parent (eyebrow) → current gallery (title) → what's inside (sub-folders),
          grouped tightly so it reads as one "location" block. The current gallery is the title — a
          small tree rooted on it — never a repeated row. */}
      <div className="space-y-2.5">
        {/* Parent crumb — sub-galleries only: the containing folder, as a folder-path step (not a
            back-button, so it reads differently from the layout's "‹ All Galleries"). Truncates so
            a long parent name can't overflow the column. */}
        {parentGallery && (
          <GalleryDropZone galleryId={parentGallery.id} zone="nav" className="rounded">
            <Link
              href={`/admin/galleries/${parentGallery.id}`}
              className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <Folder size={12} className="shrink-0" />
              <span className="truncate">{parentGallery.name}</span>
            </Link>
          </GalleryDropZone>
        )}

        {/* Title + actions. The actions float top-right, so a short title sits beside them while a
            long title wraps to the full column width underneath — conventional placement, no
            squeezing. `flow-root` contains the float. The open-folder icon marks the tree root. */}
        <div className="flex items-start gap-2">
          <FolderOpen size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 flow-root">
            <div className="float-right -mr-1.5 -mt-1 ml-2 flex items-center gap-0.5">
              <button className={iconBtn} onClick={onPreview} title={t("previewClientView")} aria-label={t("previewClientView")}>
                <Eye size={16} />
              </button>
              <button className={iconBtn} onClick={onShare} title={t("share")} aria-label={t("share")}>
                <Send size={16} />
              </button>
              <button className={iconBtn} onClick={onActivity} title={t("activityLog")} aria-label={t("activityLog")}>
                <Activity size={16} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger className={iconBtn} aria-label={t("moreActions")}>
                  <MoreVertical size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onSettings}>
                    <Settings size={14} /> {t("settings")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onRename}>
                    <Pencil size={14} /> {t("renameGallery")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onMoveGallery}>
                    <FolderInput size={14} /> {t("moveGallery")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSetHeaderImage}>
                    <Frame size={14} /> {t("setHeaderImage")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSetCoverImage}>
                    <ImageIcon size={14} /> {t("setGalleryImage")}
                  </DropdownMenuItem>
                  {gallery.enable_team_voting && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onVoting}>
                        <Vote size={14} /> {t("teamVoting")}
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onClick={onEmpty}>
                    <Eraser size={14} /> {t("emptyGallery")}
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onClick={onDelete}>
                    <Trash2 size={14} /> {t("deleteGallery")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <h1 className="text-base font-semibold text-foreground leading-tight break-words">{gallery.name}</h1>
            {gallery.headline && (
              <p className="mt-0.5 text-xs text-muted-foreground break-words">{gallery.headline}</p>
            )}
          </div>
        </div>

        {/* What's inside — sub-folders indented under the current gallery, like a small tree. The
            tree guide line only shows when there are real children, so a lone "New sub-gallery"
            action doesn't imply contents that aren't there. */}
        {(subGalleries.length > 0 || onCreateSub) && (
          <div className={cn("ml-2 space-y-0.5 pl-3", subGalleries.length > 0 && "border-l border-border")}>
            {subGalleries.map((child) => (
              <GalleryDropZone key={child.id} galleryId={child.id} zone="nav" className="rounded">
                <Link
                  href={`/admin/galleries/${child.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="flex-1 truncate">{child.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{child.image_count}</span>
                </Link>
              </GalleryDropZone>
            ))}
            {onCreateSub && (
              <button
                onClick={onCreateSub}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors w-full"
              >
                <Plus size={13} className="shrink-0" />
                <span>{t("newSubGallery")}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Upload / Download */}
      <div className="space-y-2">
        <Button className="w-full justify-start" size="sm" onClick={onUpload}>
          <UploadCloud size={15} className="mr-2" /> {t("uploadNewFiles")}
        </Button>
        <Button className="w-full justify-start" size="sm" variant="outline" onClick={onDownload}>
          <Download size={15} className="mr-2" />
          {filterActive ? t("downloadCount", { count: downloadCount }) : t("download")}
        </Button>
        <Button className="w-full justify-start" size="sm" variant="outline" onClick={onCopyFilenames}>
          <Copy size={15} className="mr-2" />
          {filterActive ? t("copyCount", { count: downloadCount }) : t("copyFilenames")}
        </Button>
      </div>

      {/* Collections */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Layers size={13} /> {t("collections")}
        </h2>

        <Button
          className="w-full justify-start"
          size="sm"
          variant={selectionMode ? "default" : "outline"}
          onClick={onToggleSelectionMode}
        >
          <CheckSquare size={15} className="mr-2" /> {selectionMode ? t("selecting") : t("select")}
        </Button>

        {selectionMode && (
          <div className="space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{t("selectedCount", { count: selectedCount })}</p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-xs"
                onClick={onToggleSelectionMode}
              >
                <X size={12} className="mr-1" /> {t("done")}
              </Button>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onSelectAll}>{t("selectAll")}</Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onClearSelection} disabled={!selectedCount}>{t("clear")}</Button>
            </div>
            <Button size="sm" className="w-full" onClick={onSaveSelection} disabled={!selectedCount}>
              <Plus size={14} className="mr-1.5" /> {t("saveAsCollection")}
            </Button>
            {activeCollectionId && onAddSelectionToCollection && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={onAddSelectionToCollection}
                disabled={!selectedCount}
              >
                <Plus size={14} className="mr-1.5" />
                {t("addToCollection", { name: collections.find((c) => c.id === activeCollectionId)?.name ?? "" })}
              </Button>
            )}
            {onCreateGalleryFromSelection && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={onCreateGalleryFromSelection}
                disabled={!selectedCount}
              >
                <FolderPlus size={14} className="mr-1.5" /> {t("galleryFromSelection")}
              </Button>
            )}
            {onRenameSelection && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={onRenameSelection}
                disabled={!selectedCount}
              >
                <Pencil size={14} className="mr-1.5" /> {t("renameSelection")}
              </Button>
            )}
            {onMoveSelection && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={onMoveSelection}
                disabled={!selectedCount}
              >
                <FolderInput size={14} className="mr-1.5" /> {t("moveToGallery")}
              </Button>
            )}
            {onDeleteSelection && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs text-destructive hover:text-destructive"
                onClick={onDeleteSelection}
                disabled={!selectedCount}
              >
                <Trash2 size={14} className="mr-1.5" /> {t("deleteSelection")}
              </Button>
            )}
          </div>
        )}

        {filterActive && (
          <div className="space-y-1.5">
            <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onSaveFilter}>
              <Plus size={14} className="mr-1.5" /> {t("saveFilter")}
            </Button>
            {onCreateGalleryFromFilter && (
              <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onCreateGalleryFromFilter}>
                <FolderPlus size={14} className="mr-1.5" /> {t("galleryFromFilter")}
              </Button>
            )}
          </div>
        )}

        {collections.length > 0 && (
          <ul className="space-y-0.5 pt-1">
            {collections.map((c) => {
              const active = c.id === activeCollectionId;
              return (
                <li
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1 text-sm",
                    active ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => onFilterCollection?.(active ? null : c.id)}
                    title={active ? t("clearFilter") : t("show", { name: c.name })}
                  >
                    <span className="block truncate">
                      {c.name} <span className="text-muted-foreground text-xs">({c.image_count})</span>
                    </span>
                    {c.created_by && <span className="block text-[10px] text-muted-foreground truncate">{t("by", { name: c.created_by })}</span>}
                  </button>
                  <button
                    onClick={() => onCreateGalleryFromCollection?.(c)}
                    title={t("galleryFromCollection")}
                    className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <FolderPlus size={13} />
                  </button>
                  <button
                    onClick={() => onRenameCollection?.(c)}
                    title={t("renameCollection")}
                    className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => onDownloadCollection?.(c)}
                    title={t("downloadCollection")}
                    className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={() => onDeleteCollection?.(c)}
                    title={t("deleteCollection")}
                    className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
