// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Collection, GalleryPublicResponse, ImageResponse } from "@/lib/types";
import type { useGalleryZip } from "@/hooks/useGalleryZip";
import type { useImageSelection } from "@/hooks/useImageSelection";
import { ClientUploadButton } from "./ClientUploadButton";
import { StudioMasthead } from "./StudioMasthead";
import {
  Loader2, Folder, FolderOpen, Plus, CheckSquare, Download, Trash2, Pencil, Layers, X,
} from "lucide-react";
import { Icons } from "@/lib/ui-icons";

interface CollabSidebarProps {
  gallery: GalleryPublicResponse;
  shareToken: string;
  galleryToken?: string;
  collabMode: boolean;
  teamVoting: boolean;
  reviewerName: string | null;
  lightboxImages: ImageResponse[];
  filterActive: boolean;
  onDownload: () => void;
  zip: ReturnType<typeof useGalleryZip>;
  collectionsEnabled: boolean;
  selection: ReturnType<typeof useImageSelection>;
  collections: Collection[];
  activeCollection: string | null;
  setActiveCollection: (id: string | null) => void;
  onSaveSelection: () => void;
  onSaveFilter: () => void;
  onDeleteCollection: (id: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
  // Client review-mode switch: the client entered review from a showcase gallery and may go back.
  canSwitchBack?: boolean;
  onSwitchBack?: () => void;
}

/**
 * The public collaboration ("review") gallery's left sidebar: studio identity, title, sub-gallery
 * navigation, download / add-photos actions, and the collections panel. Extracted from GalleryView
 * verbatim; below md it is the same element restyled into an off-canvas drawer (toolsOpen).
 */
export function CollabSidebar({
  gallery, shareToken, galleryToken, collabMode, teamVoting, reviewerName,
  lightboxImages, filterActive, onDownload, zip, collectionsEnabled, selection, collections,
  activeCollection, setActiveCollection, onSaveSelection, onSaveFilter, onDeleteCollection, onRenameCollection,
  toolsOpen, setToolsOpen, canSwitchBack, onSwitchBack,
}: CollabSidebarProps) {
  const t = useTranslations("gallery");
  const tc = useTranslations("common");

  // Sidebar chrome — semantic theme tokens (resolved from the gallery scope), matching the admin
  // sidebar so the public nav can't drift from it.
  const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const linkBase = "text-muted-foreground hover:text-foreground hover:bg-accent/50";
  const countCls = "text-muted-foreground";

  return (
    <aside className={`w-72 shrink-0 overflow-y-auto border-r border-border bg-background md:sticky md:top-0 md:h-screen max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:max-w-[84vw] max-md:shadow-xl max-md:transition-transform max-md:duration-200 ${toolsOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}>
      {/* Mobile drawer header with close */}
      <div className="md:hidden flex items-center justify-between px-4 pt-4">
        <span className={labelCls}>{t("view.filtersAndTools")}</span>
        <button
          onClick={() => setToolsOpen(false)}
          aria-label={tc("close")}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X size={18} />
        </button>
      </div>
      {/* Studio identity — desktop band; fixed height aligns with the toolbar's bottom border */}
      {gallery.instance_name && (
        <div className="hidden md:flex h-16 shrink-0 items-center px-4 border-b border-border">
          <StudioMasthead
            name={gallery.instance_name}
            logoUrl={gallery.logo_url}
            textClassName="text-foreground"
          />
        </div>
      )}
      <div className="px-4 py-5 space-y-5">
        {/* Studio identity — mobile drawer only (desktop uses the band above) */}
        {gallery.instance_name && (
          <div className="md:hidden pb-4 border-b border-border">
            <StudioMasthead
              name={gallery.instance_name}
              logoUrl={gallery.logo_url}
              textClassName="text-foreground"
            />
          </div>
        )}
        {/* Where you are: parent (eyebrow) → current gallery (title) → what's inside, grouped
            tightly. The current gallery is the title — a small tree rooted on it. */}
        <div className="space-y-2.5">
          {gallery.parent_share_token && (
            <Link
              href={`/g/${gallery.parent_share_token}`}
              className={`flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors ${linkBase}`}
            >
              <Folder size={12} className="shrink-0" />
              <span className="truncate">{gallery.parent_name}</span>
            </Link>
          )}
          <div>
            <div className="flex items-start gap-2">
              <FolderOpen size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <h1 className="text-base font-semibold leading-tight break-words text-foreground">
                  {gallery.name}
                </h1>
                {gallery.headline && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{gallery.headline}</p>
                )}
              </div>
            </div>
            {teamVoting && reviewerName && (
              <span className="mt-2 inline-block text-xs rounded px-2 py-0.5 text-muted-foreground bg-accent">
                {t.rich("view.reviewingAs", {
                  name: reviewerName,
                  b: (chunks) => <span className="text-foreground font-medium">{chunks}</span>,
                })}
              </span>
            )}
          </div>
          {gallery.subgalleries.length > 0 && (
            <div className="ml-2 space-y-0.5 border-l border-border pl-3">
              {gallery.subgalleries.map((sub) => (
                <Link
                  key={sub.share_token}
                  href={`/g/${sub.share_token}`}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${linkBase}`}
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="flex-1 truncate">{sub.name}</span>
                  <span className={`text-xs tabular-nums ${countCls}`}>{sub.image_count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Actions — Download / Add photos. The same shadcn Button as the admin sidebar;
            colors resolve from the gallery scope, so they can't drift from the admin. */}
        {((gallery.downloads_enabled && lightboxImages.length > 0) || gallery.client_upload_enabled) && (
          <div className="space-y-2">
            {gallery.downloads_enabled && lightboxImages.length > 0 && (
              <>
                <Button className="w-full justify-start" size="sm" onClick={onDownload} disabled={zip.preparing}>
                  {zip.preparing ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Download size={15} className="mr-2" />}
                  {zip.preparing
                    ? t("view.preparing")
                    : filterActive
                      ? t("view.downloadFiles", { count: lightboxImages.length })
                      : t("view.download")}
                </Button>
                {zip.error && <p className="text-xs text-destructive">{zip.error}</p>}
              </>
            )}

            {gallery.client_upload_enabled && (
              <ClientUploadButton
                shareToken={shareToken}
                galleryToken={galleryToken}
                moderation={gallery.client_upload_moderation}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-start gap-3")}
              />
            )}
          </div>
        )}

        {/* Collections */}
        {collectionsEnabled && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Layers size={13} /> {t("collections.title")}
            </h2>

            <Button
              className="w-full justify-start"
              size="sm"
              variant={selection.mode ? "default" : "outline"}
              onClick={() => selection.setMode(!selection.mode)}
            >
              <CheckSquare size={15} className="mr-2" /> {selection.mode ? t("collections.selecting") : t("collections.select")}
            </Button>

            {selection.mode && (
              <div className="space-y-1.5 rounded-lg border border-border p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{t("collections.selectedCount", { count: selection.count })}</p>
                  <Button size="sm" variant="outline" className="h-6 px-2.5 text-xs" onClick={() => selection.setMode(false)}>
                    <X size={12} className="mr-1" /> {t("collections.done")}
                  </Button>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={selection.selectAll}>{t("collections.selectAll")}</Button>
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={selection.clear} disabled={!selection.count}>{t("collections.clear")}</Button>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!selection.count}
                  onClick={onSaveSelection}
                >
                  <Plus size={14} className="mr-1.5" /> {t("collections.saveAs")}
                </Button>
              </div>
            )}

            {filterActive && (
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start text-xs"
                onClick={onSaveFilter}
              >
                <Plus size={14} className="mr-1.5" /> {t("collections.saveFilter")}
              </Button>
            )}

            {collections.length > 0 && (
              <ul className="space-y-0.5 pt-1">
                {collections.map((c) => {
                  const active = c.id === activeCollection;
                  // A visitor may rename/delete only the collections they created (admin isn't here).
                  const canEdit = !!reviewerName && c.created_by === reviewerName;
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1 text-sm",
                        active ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      <button className="flex-1 min-w-0 text-left" onClick={() => setActiveCollection(active ? null : c.id)} title={active ? t("collections.clearFilter") : t("collections.show", { name: c.name })}>
                        <span className="block truncate">
                          {c.name} <span className="text-muted-foreground text-xs">({c.image_count})</span>
                        </span>
                        {c.created_by && <span className="block text-[10px] text-muted-foreground truncate">{t("collections.by", { name: c.created_by })}</span>}
                      </button>
                      {gallery.downloads_enabled && (
                        <button onClick={() => zip.startImages(c.image_ids)} title={t("collections.downloadCollection")} className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1">
                          <Download size={13} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => {
                            const next = prompt(t("collections.renamePrompt"), c.name)?.trim();
                            if (next && next !== c.name) onRenameCollection(c.id, next);
                          }}
                          title={t("collections.renameCollection")}
                          className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => { if (confirm(t("collections.deleteConfirm", { name: c.name }))) onDeleteCollection(c.id); }}
                          title={t("collections.deleteCollection")}
                          className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Collab hint inline */}
        {collabMode && !teamVoting && (
          <p className="text-xs text-muted-foreground">
            {t("view.collabHint")}
          </p>
        )}

        {/* Back to the showcase view (client review-mode switch) */}
        {canSwitchBack && (
          <Button className="w-full justify-start" size="sm" variant="outline" onClick={onSwitchBack}>
            <Icons.modeShowcase size={15} className="mr-2" /> {t("view.backToShowcase")}
          </Button>
        )}
      </div>
    </aside>
  );
}
