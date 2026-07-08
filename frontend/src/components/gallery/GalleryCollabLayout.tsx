// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { GalleryToolbar } from "./GalleryToolbar";
import { CollabSidebar } from "./CollabSidebar";
import { Menu } from "lucide-react";
import type { GalleryViewModel } from "./useGalleryView";

/**
 * Two-column layout for collaboration galleries (and their sub-galleries): the CollabSidebar plus
 * a main column with the sticky toolbar and the photo content. Shared content (sub-gallery cards,
 * the photo grid, the footer) is passed in as slots so the building logic stays in one place.
 */
export function GalleryCollabLayout({
  vm,
  upNav,
  breadcrumb,
  subGalleryCards,
  photoGrid,
  galleryFooter,
}: {
  vm: GalleryViewModel;
  upNav: ReactNode;
  breadcrumb: ReactNode;
  subGalleryCards: ReactNode;
  photoGrid: ReactNode;
  galleryFooter: ReactNode;
}) {
  const t = useTranslations("gallery");
  const {
    gallery,
    shareToken,
    galleryToken,
    photosRef,
    collabMode,
    teamVoting,
    reviewerName,
    bright,
    features,
    arrange,
    setArrange,
    rawImages,
    filteredSorted,
    captureSortAvailable,
    collections,
    zip,
    selection,
    lightboxImages,
    filterActive,
    collectionsEnabled,
    activeCollection,
    setActiveCollection,
    setSaveCollectionName,
    setPendingCollectionIds,
    toolsOpen,
    setToolsOpen,
    handleDownload,
    deleteCollectionMutation,
    renameCollectionMutation,
  } = vm;

  // Manual header wins; else the opt-in auto-header fallback (a photo picked server-side).
  const headerImage = gallery.header_image_url ?? gallery.header_image_fallback_url;

  return (
    /* Two-column layout for collaboration galleries (and their sub-galleries) */
    <div className="flex flex-col min-h-screen">
      {/* Full-width header image above the two-column split */}
      {headerImage && (
        <div className="w-full shrink-0" style={{ height: "clamp(180px, 30vw, 340px)", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headerImage}
            alt=""
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full object-cover select-none [-webkit-touch-callout:none]"
            style={{ objectPosition: `${gallery.header_focus_x ?? 50}% ${gallery.header_focus_y ?? 50}%` }}
          />
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      {/* Sidebar (static column on md+, off-canvas drawer below md) — collaboration galleries */}
      <CollabSidebar
        gallery={gallery}
        shareToken={shareToken}
        galleryToken={galleryToken}
        collabMode={collabMode}
        teamVoting={teamVoting}
        reviewerName={reviewerName}
        lightboxImages={lightboxImages}
        filterActive={filterActive}
        onDownload={handleDownload}
        zip={zip}
        collectionsEnabled={collectionsEnabled}
        selection={selection}
        collections={collections}
        activeCollection={activeCollection}
        setActiveCollection={setActiveCollection}
        onSaveSelection={() => { setPendingCollectionIds([...selection.selected]); setSaveCollectionName(""); }}
        onSaveFilter={() => { setPendingCollectionIds(lightboxImages.map((i) => i.id)); setSaveCollectionName(""); }}
        onDeleteCollection={(cid) => deleteCollectionMutation.mutate(cid)}
        onRenameCollection={(cid, name) => renameCollectionMutation.mutate({ collectionId: cid, name })}
        toolsOpen={toolsOpen}
        setToolsOpen={setToolsOpen}
        canSwitchBack={vm.canSwitchMode && vm.reviewSwitched}
        onSwitchBack={vm.toggleReviewMode}
      />

      {/* Mobile backdrop for the tools drawer */}
      {toolsOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setToolsOpen(false)}
          aria-hidden
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Sticky top band: mobile up-nav + mobile menu bar (mobile only) + view toolbar (all sizes) */}
        <div className="sticky top-0 z-30">
          {/* Mobile-only "go up to parent" bar (null for top-level galleries) */}
          {upNav}
          {/* Mobile menu bar — opens the nav/download/collections drawer */}
          <div className={`md:hidden flex items-center gap-2 border-b px-4 py-2 ${bright ? "border-zinc-200 bg-zinc-50/95" : "border-zinc-800 bg-zinc-950/95"}`}>
            <button
              onClick={() => setToolsOpen(true)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 h-9 text-sm font-medium transition-colors ${bright ? "border-zinc-300 text-zinc-700 hover:bg-zinc-100" : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"}`}
            >
              <Menu size={15} /> {t("view.menu")}
            </button>
            <span className={`truncate text-sm font-medium ${bright ? "text-zinc-900" : "text-zinc-100"}`}>{gallery.name}</span>
          </div>
          {/* View controls — the shared toolbar; colors come from the gallery scope */}
          <GalleryToolbar
            arrange={arrange}
            setArrange={setArrange}
            features={features}
            captureSortAvailable={captureSortAvailable}
            shownCount={filteredSorted.length}
            totalCount={rawImages.length}
            className="px-4 py-2.5"
          />
        </div>
        <main ref={photosRef} className="p-4 space-y-5">
          {breadcrumb}
          {subGalleryCards}
          {photoGrid}
          {galleryFooter}
        </main>
      </div>
      </div>{/* end inner flex row */}
    </div>
  );
}
