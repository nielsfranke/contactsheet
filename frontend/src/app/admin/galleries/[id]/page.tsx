// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SidebarPortal, SubGalleryCard } from "./parts";
import { useGalleryDetail } from "./useGalleryDetail";
import { GalleryDetailDialogs } from "./GalleryDetailDialogs";
import type { GalleryResponse } from "@/lib/types";
import { GRID_COLS, GAP } from "@/lib/gridLayout";
import { cn } from "@/lib/utils";
import { UploadZone } from "@/components/admin/UploadZone";
import { AdminImageGrid } from "@/components/admin/AdminImageGrid";
import { GalleryAdminSidebar } from "@/components/admin/GalleryAdminSidebar";
import { PendingReviewBanner } from "@/components/admin/PendingReviewBanner";
import { GalleryViewToolbar } from "@/components/admin/GalleryViewToolbar";
import { GalleryFooter } from "@/components/gallery/GalleryFooter";
import { useAdminMobileHeader } from "@/store/adminMobileHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Image as ImageIcon, Plus } from "lucide-react";

export default function GalleryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("admin.detail");
  const tShell = useTranslations("admin.shell");

  const d = useGalleryDetail(id);
  const {
    gallery,
    isLoading,
    adminSettings,
    children,
    parentGallery,
    images,
    refetchImages,
    upload,
    collections,
    filteredSorted,
    captureSortAvailable,
    lightboxList,
    visibleIds,
    selection,
    groups,
    adminGrid,
    activeDragId,
    arrange,
    setArrange,
    openSettings,
    handleDownload,
    setShareOpen,
    setCopyNamesOpen,
    setRenameValue,
    setRenameOpen,
    setMoveGalleryOpen,
    setEmptyConfirm,
    setHeaderImageOpen,
    setCoverImageOpen,
    setActivityOpen,
    setVotingOpen,
    setDeleteConfirm,
    setCreateSubOpen,
    setSharingSubId,
    activeCollection,
    setActiveCollection,
    setSaveCollectionOpen,
    setSaveCollectionName,
    setPendingCollectionIds,
    setDeleteCollectionTarget,
    adminZip,
    setHeaderFromImageMutation,
    coverMutation,
    setRenameImageValue,
    setRenameImageTarget,
    setMoveImageTarget,
    setMoveSelectionOpen,
    setRenameCollectionTarget,
    setRenameCollectionValue,
    addSelectionToCollection,
    removeFromCollection,
  } = d;

  // Drive the admin shell's mobile top bar with a "go up" context (parent gallery, or the galleries
  // overview for a top-level one), so the bar replaces the global brand instead of stacking a
  // second up-nav row below it. Cleared on unmount so other admin pages keep the brand.
  const setMobileHeaderNav = useAdminMobileHeader((s) => s.setNav);
  const upLabel = parentGallery ? parentGallery.name : tShell("allGalleries");
  const upHref = parentGallery ? `/admin/galleries/${parentGallery.id}` : "/admin/galleries";
  useEffect(() => {
    if (!gallery) return;
    setMobileHeaderNav({ label: upLabel, href: upHref });
    return () => setMobileHeaderNav(null);
    // Primitive deps (not the translator/objects) so this only re-runs on a real context change.
  }, [gallery, upLabel, upHref, setMobileHeaderNav]);

  if (isLoading || !gallery) {
    return (
      <div className="p-6 space-y-6" aria-hidden="true">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      </div>
    );
  }

  const galleryWithChildren: GalleryResponse = { ...gallery, children };
  const isCollab = gallery.mode === "collaboration";

  return (
    <>
    <div className="min-h-full">
      {/* Shared hidden file input for both upload triggers */}
      <input {...upload.inputProps} />

      <SidebarPortal>
        <GalleryAdminSidebar
          gallery={gallery}
          parentGallery={parentGallery}
          subGalleries={children}
          downloadCount={lightboxList.length}
          onSettings={() => openSettings("general")}
          onPreview={() => window.open(`/g/${gallery.share_token}`, "_blank")}
          onShare={() => setShareOpen(true)}
          onUpload={upload.openPicker}
          onDownload={handleDownload}
          onCopyFilenames={() => setCopyNamesOpen(true)}
          onRename={() => { setRenameValue(gallery.name); setRenameOpen(true); }}
          onMoveGallery={() => setMoveGalleryOpen(true)}
          onEmpty={() => setEmptyConfirm(true)}
          onSetHeaderImage={() => setHeaderImageOpen(true)}
          onSetCoverImage={() => setCoverImageOpen(true)}
          onActivity={() => setActivityOpen(true)}
          onVoting={() => setVotingOpen(true)}
          onDelete={() => setDeleteConfirm(true)}
          onCreateSub={() => setCreateSubOpen(true)}
          arrange={arrange}
          collections={collections}
          selectionMode={selection.mode}
          selectedCount={selection.count}
          onToggleSelectionMode={() => selection.setMode(!selection.mode)}
          onSelectAll={selection.selectAll}
          onClearSelection={selection.clear}
          onSaveSelection={() => { setPendingCollectionIds([...selection.selected]); setSaveCollectionName(""); setSaveCollectionOpen(true); }}
          onSaveFilter={() => { setPendingCollectionIds(visibleIds); setSaveCollectionName(""); setSaveCollectionOpen(true); }}
          activeCollectionId={activeCollection}
          onFilterCollection={setActiveCollection}
          onDownloadCollection={(c) => adminZip.startImages(c.image_ids)}
          onDeleteCollection={(c) => setDeleteCollectionTarget(c)}
          onRenameCollection={(c) => { setRenameCollectionValue(c.name); setRenameCollectionTarget(c); }}
          onAddSelectionToCollection={addSelectionToCollection}
          onMoveSelection={() => setMoveSelectionOpen(true)}
          onCreateGalleryFromCollection={d.startGalleryFromCollection}
          onCreateGalleryFromFilter={d.startGalleryFromFilter}
          onCreateGalleryFromSelection={d.startGalleryFromSelection}
        />
      </SidebarPortal>

      {/* The mobile "go up" affordance lives in the shell's top bar (see the useEffect above), not
          a separate in-page bar, so the parent context shares one row with the menu button. */}

      {/* Full-width header strip — sits above the padded canvas */}
      {gallery.header_image_url ? (
        <button
          onClick={() => setHeaderImageOpen(true)}
          className="group relative block w-full overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery.header_image_url}
            alt="Header"
            className="w-full object-cover transition-[filter] duration-200 group-hover:brightness-75"
            style={{
              height: "clamp(160px, 25vw, 320px)",
              objectPosition: `${gallery.header_focus_x ?? 50}% ${gallery.header_focus_y ?? 50}%`,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="inline-flex items-center gap-2 rounded-lg bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
              <ImageIcon size={14} /> {t("editHeaderImage")}
            </span>
          </div>
        </button>
      ) : null}

      {/* Main canvas */}
      <main className="p-6 space-y-6">
        {/* Client uploads awaiting approval (only when this gallery moderates uploads) */}
        <PendingReviewBanner galleryId={gallery.id} images={images} />

        {/* View controls (filter / sort / group) — sticky toolbar over the grid */}
        <GalleryViewToolbar
          arrange={arrange}
          setArrange={setArrange}
          captureSortAvailable={captureSortAvailable}
          shownCount={filteredSorted.length}
          totalCount={images.length}
        />

        {/* Header / cover image buttons — only for an empty gallery, where there's no photo grid and
            this is the sole visible CTA (and no photo to pick a cover from). Once the gallery has
            photos these actions live solely in the sidebar/kebab, keeping the top of the canvas for
            the grid instead of a redundant button block. */}
        {images.length === 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {!gallery.header_image_url && (
              <Button variant="outline" size="sm" onClick={() => setHeaderImageOpen(true)}>
                <ImageIcon size={14} className="mr-1.5" /> {t("setHeaderImage")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setCoverImageOpen(true)}>
              <ImageIcon size={14} className="mr-1.5" /> {t("setCoverImage")}
            </Button>
          </div>
        )}

        {/* Photo grid — mirrors the gallery's client look by default, or an instance-wide
            admin-view override (Settings → Admin View) when set to custom. */}
        <AdminImageGrid
          images={filteredSorted}
          groups={groups}
          galleryId={id}
          onRefetch={refetchImages}
          emptyMessage={images.length === 0 ? t("emptyNoImages") : t("emptyFiltered")}
          draggable={arrange.sortKey === "manual" && !groups && !selection.mode}
          onOpen={d.openPreview}
          selectionMode={selection.mode}
          isSelected={selection.isSelected}
          onToggleSelect={selection.toggle}
          onRangeSelect={selection.selectRange}
          onSetHeaderImage={(img) => setHeaderFromImageMutation.mutate(img.id)}
          onSetCoverImage={(img) => coverMutation.mutate(img.id)}
          onRenameImage={(img) => { setRenameImageValue(img.original_filename); setRenameImageTarget(img); }}
          onMoveImage={(img) => setMoveImageTarget(img)}
          onRemoveFromCollection={activeCollection ? (img) => removeFromCollection(img.id) : undefined}
          dragEnabled
          activeId={activeDragId}
          layout={adminGrid?.layout ?? gallery.layout}
          presentation={adminGrid?.presentation ?? {
            previewSize: gallery.preview_size,
            previewSpacing: gallery.preview_spacing,
            previewCorners: gallery.preview_corners,
          }}
        />

        {/* Upload drop zone */}
        <UploadZone
          uploading={upload.uploading}
          progress={upload.progress}
          onFiles={upload.uploadFiles}
          onClick={upload.openPicker}
          onCancel={upload.cancelUpload}
        />

        {/* Sub-galleries */}
        <section className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">{t("subGalleries")}</h2>
            <Button variant="outline" size="sm" onClick={() => setCreateSubOpen(true)}>
              <Plus size={14} className="mr-1.5" /> {t("createSubGallery")}
            </Button>
          </div>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.rich("noSubGalleries", { b: (c) => <span className="text-foreground font-medium">{c}</span> })}
            </p>
          ) : (
            <div className={cn("grid", GRID_COLS[adminGrid?.presentation.previewSize ?? "medium"], GAP[adminGrid?.presentation.previewSpacing ?? "medium"])}>
              {children.map((child) => (
                <SubGalleryCard key={child.id} child={child} parentId={id} onShare={() => setSharingSubId(child.id)} />
              ))}
            </div>
          )}
        </section>

        {/* Branding footer preview — mirrors what clients see (when enabled instance-wide) */}
        {adminSettings?.footer_enabled && adminSettings.footer && (
          <GalleryFooter
            footer={adminSettings.footer}
            accent={adminSettings.accent_color}
            bright={false}
            themed
          />
        )}
      </main>

      <GalleryDetailDialogs
        d={d}
        gallery={gallery}
        galleryWithChildren={galleryWithChildren}
        isCollab={isCollab}
      />
    </div>
    </>
  );
}
