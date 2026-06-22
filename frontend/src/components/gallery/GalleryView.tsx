// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { GalleryPublicResponse, ImageResponse } from "@/lib/types";
import { PhotoGrid } from "./PhotoGrid";
import { GalleryFooter } from "./GalleryFooter";
import { GalleryBreadcrumb } from "./GalleryBreadcrumb";
import { GalleryUpNav } from "./GalleryUpNav";
import { cn } from "@/lib/utils";
import { Lightbox } from "./Lightbox";
import { ReviewerNamePrompt } from "./ReviewerNamePrompt";
import { DownloadGalleryDialog } from "./DownloadGalleryDialog";
import { SaveCollectionDialog } from "./SaveCollectionDialog";
import { useGalleryView } from "./useGalleryView";
import { GalleryCollabLayout } from "./GalleryCollabLayout";
import { GalleryPresentationLayout } from "./GalleryPresentationLayout";
import { CoverPlaceholder } from "@/components/chrome/CoverPlaceholder";
import { Loader2 } from "lucide-react";

interface Props {
  gallery: GalleryPublicResponse;
  shareToken: string;
  galleryToken?: string;
}

export function GalleryView({ gallery, shareToken, galleryToken }: Props) {
  const t = useTranslations("gallery");
  const vm = useGalleryView(gallery, shareToken, galleryToken);
  const {
    collabMode,
    teamVoting,
    watermarkEnabled,
    bright,
    features,
    presentation,
    showPrompt,
    setShowPrompt,
    downloadOpen,
    setDownloadOpen,
    saveCollectionName,
    setSaveCollectionName,
    pendingCollectionIds,
    rawImages,
    isLoading,
    zip,
    votesByImageId,
    voteRatingByImageId,
    likedSet,
    filteredSorted,
    selection,
    groups,
    lightboxImages,
    isOpen,
    hasNav,
    isContainer,
    showSidebar,
    createCollectionMutation,
    handleVote,
    handleRatingVote,
    toggleLike,
  } = vm;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={32} className="text-zinc-500 animate-spin" />
      </div>
    );
  }

  function renderGrid(imgs: ImageResponse[]) {
    return (
      <PhotoGrid
        images={imgs}
        layout={gallery.layout}
        collabMode={collabMode}
        shareToken={shareToken}
        galleryToken={galleryToken}
        teamVoting={teamVoting}
        reviewerVotes={votesByImageId}
        onVote={handleVote}
        reviewerRatings={voteRatingByImageId}
        onRatingVote={handleRatingVote}
        likedSet={likedSet}
        onToggleLike={toggleLike}
        features={features}
        presentation={presentation}
        selectionMode={selection.mode}
        isSelected={selection.isSelected}
        onToggleSelect={selection.toggle}
        onRangeSelect={selection.selectRange}
        lightboxImages={lightboxImages}
      />
    );
  }

  const photoGrid = isContainer ? null : filteredSorted.length === 0 ? (
    <div className={`text-center py-16 ${bright ? "text-zinc-500" : "text-zinc-400"}`}>
      <p>{rawImages.length === 0 ? t("view.emptyGallery") : t("view.emptyFilter")}</p>
      {rawImages.length > 0 && (
        <button
          onClick={() => vm.setArrange({ ...vm.arrange, filterName: "", flagFilters: new Set(), ratingFilters: new Set(), commentsOnly: false })}
          className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-foreground bg-secondary hover:bg-secondary/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("toolbar.clearFilters")}
        </button>
      )}
    </div>
  ) : groups ? (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className={`text-xs font-medium uppercase tracking-wide mb-2 ${bright ? "text-zinc-500" : "text-zinc-500"}`}>
            {g.key.startsWith("rating:")
              ? (g.key === "rating:0" ? t("stars.unrated") : t("stars.nStars", { count: Number(g.key.slice(7)) }))
              : t(`flags.${g.key}`)} <span className="opacity-60">({g.images.length})</span>
          </h3>
          {renderGrid(g.images)}
        </section>
      ))}
    </div>
  ) : (
    renderGrid(filteredSorted)
  );

  // Sub-gallery cover-card chrome — semantic theme tokens (resolved from the gallery scope).
  const folderCard = "bg-card border-border hover:border-muted-foreground text-card-foreground";
  const coverBg = "bg-muted";

  // Container galleries (no own photos) present their children as centered cover cards — a tidy
  // "choose a section" landing page. Content galleries surface children via the breadcrumb instead.
  const subGalleryCards = isContainer ? (
    <div className="flex flex-wrap justify-center gap-4">
      {gallery.subgalleries.map((sub) => (
        <Link
          key={sub.share_token}
          href={`/g/${sub.share_token}`}
          className={`w-[260px] max-w-full rounded-lg border overflow-hidden transition-colors ${folderCard}`}
        >
          <div className={`aspect-video ${coverBg}`}>
            {sub.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sub.cover_image_url} alt={sub.name} draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-full h-full object-cover select-none" />
            ) : (
              <CoverPlaceholder name={sub.name} />
            )}
          </div>
          <div className="p-2">
            <p className="text-sm font-medium truncate">{sub.name}</p>
            <p className="text-xs text-muted-foreground">{t("photoCount", { count: sub.image_count })}</p>
          </div>
        </Link>
      ))}
    </div>
  ) : null;

  // Mobile-only sticky "go up" bar — an obvious way out of a sub-folder on a phone, shared by both
  // layouts. Hidden at md+ (desktop keeps the breadcrumb / sidebar) and null for top-level galleries.
  const upNav = (
    <GalleryUpNav
      label={gallery.parent_name}
      href={gallery.parent_share_token ? `/g/${gallery.parent_share_token}` : null}
    />
  );

  // Breadcrumb nav (presentation mode): ancestor chain → current → child links. On mobile it's
  // hidden when it has no child links (pure ancestors → current), since the sticky up-nav + the
  // heading already cover that; it stays on mobile when it carries sub-gallery links the up-nav
  // can't. Desktop always shows it.
  const breadcrumb = hasNav ? (
    <div className={gallery.subgalleries.length === 0 ? "max-md:hidden" : undefined}>
      <GalleryBreadcrumb
        ancestors={gallery.ancestors}
        current={gallery.name}
        items={gallery.subgalleries.map((s) => ({ name: s.name, share_token: s.share_token }))}
        bright={bright}
      />
    </div>
  ) : null;

  // Global branding footer (present only when enabled instance-wide), shown at the bottom of
  // the gallery content in every layout.
  const galleryFooter = gallery.footer ? (
    <GalleryFooter footer={gallery.footer} accent={gallery.accent_color ?? "#000000"} bright={bright} />
  ) : null;

  return (
    <div className={cn("min-h-screen gallery-scope text-foreground", !bright && "dark", bright ? "bg-zinc-50" : "bg-zinc-950")}>
      {showPrompt && (
        <ReviewerNamePrompt onConfirmed={() => setShowPrompt(false)} />
      )}

      {saveCollectionName !== null && (
        <SaveCollectionDialog
          name={saveCollectionName}
          imageCount={pendingCollectionIds.length}
          saving={createCollectionMutation.isPending}
          onNameChange={setSaveCollectionName}
          onCancel={() => setSaveCollectionName(null)}
          onSubmit={() => {
            const name = saveCollectionName.trim();
            if (!name || pendingCollectionIds.length === 0) return;
            createCollectionMutation.mutate({ name, imageIds: pendingCollectionIds });
          }}
        />
      )}

      {showSidebar ? (
        <GalleryCollabLayout
          vm={vm}
          upNav={upNav}
          subGalleryCards={subGalleryCards}
          photoGrid={photoGrid}
          galleryFooter={galleryFooter}
        />
      ) : (
        <GalleryPresentationLayout
          vm={vm}
          upNav={upNav}
          breadcrumb={breadcrumb}
          subGalleryCards={subGalleryCards}
          photoGrid={photoGrid}
          galleryFooter={galleryFooter}
        />
      )}

      {/* Lightbox portal */}
      {isOpen && (
        <Lightbox
          downloadsEnabled={gallery.downloads_enabled}
          backdrop={gallery.lightbox_backdrop}
          collabMode={collabMode}
          shareToken={shareToken}
          galleryToken={galleryToken}
          teamVoting={teamVoting}
          reviewerVotes={votesByImageId}
          onVote={handleVote}
          reviewerRatings={voteRatingByImageId}
          onRatingVote={handleRatingVote}
          likedSet={likedSet}
          onToggleLike={toggleLike}
          watermarkEnabled={watermarkEnabled}
          highRes={gallery.high_res_previews}
          features={features}
          showFilename={gallery.show_filename_lightbox}
          showExif={gallery.show_exif}
          showIptc={gallery.show_iptc}
          protectImages
        />
      )}

      {/* Download dialog (sub-gallery selection) */}
      <DownloadGalleryDialog
        galleryName={gallery.name}
        rootCount={gallery.image_count}
        subGalleries={gallery.subgalleries.map((s) => ({ id: s.share_token, name: s.name, count: s.image_count }))}
        open={downloadOpen}
        onOpenChange={(o) => { setDownloadOpen(o); if (!o) zip.setError(null); }}
        onStart={(tokens) => zip.start(tokens, () => setDownloadOpen(false))}
        preparing={zip.preparing}
        error={zip.error}
      />
    </div>
  );
}
