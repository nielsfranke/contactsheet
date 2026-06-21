// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import type { GalleryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GallerySettingsModal } from "@/components/admin/GallerySettingsModal";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { VotingSummary } from "@/components/admin/VotingSummary";
import { ShareDialog } from "@/components/admin/ShareDialog";
import { CreateSubGalleryDialog } from "@/components/admin/CreateSubGalleryDialog";
import { CreateGalleryFromImagesDialog } from "@/components/admin/CreateGalleryFromImagesDialog";
import { MoveGalleryDialog } from "@/components/admin/MoveGalleryDialog";
import { Lightbox } from "@/components/gallery/Lightbox";
import { DownloadGalleryDialog } from "@/components/gallery/DownloadGalleryDialog";
import { CopyFilenamesDialog } from "@/components/admin/CopyFilenamesDialog";
import { HeaderImageDialog } from "@/components/admin/HeaderImageDialog";
import { CoverImageDialog } from "@/components/admin/CoverImageDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { Download, CornerDownRight } from "lucide-react";
import type { GalleryDetail } from "./useGalleryDetail";

/**
 * The whole modal/dialog cluster for the admin gallery detail page. Renders off the controller
 * hook's return value (`d`); `gallery`/`galleryWithChildren`/`isCollab` are passed narrowed
 * (non-null) by the page after its loading guard.
 */
export function GalleryDetailDialogs({
  d,
  gallery,
  galleryWithChildren,
  isCollab,
}: {
  d: GalleryDetail;
  gallery: GalleryResponse;
  galleryWithChildren: GalleryResponse;
  isCollab: boolean;
}) {
  const t = useTranslations("admin.detail");
  const tc = useTranslations("common");

  const {
    id,
    images,
    children,
    filteredSorted,
    filterActive,
    activeCollection,
    flagged,
    adminSettings,
    adminZip,
    moveTargets,
    moveExcludedIds,
    downloadExport,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    updateMutation,
    saveCollectionOpen,
    setSaveCollectionOpen,
    saveCollectionName,
    setSaveCollectionName,
    pendingCollectionIds,
    createCollectionMutation,
    downloadOpen,
    setDownloadOpen,
    copyNamesOpen,
    setCopyNamesOpen,
    shareOpen,
    setShareOpen,
    activityOpen,
    setActivityOpen,
    votingOpen,
    setVotingOpen,
    createSubOpen,
    setCreateSubOpen,
    sharingSubId,
    setSharingSubId,
    lightboxOpen,
    deleteConfirm,
    setDeleteConfirm,
    deleteMutation,
    deleteCollectionTarget,
    setDeleteCollectionTarget,
    deleteCollectionMutation,
    renameCollectionTarget,
    setRenameCollectionTarget,
    renameCollectionValue,
    setRenameCollectionValue,
    updateCollectionMutation,
    emptyConfirm,
    setEmptyConfirm,
    emptyMutation,
    renameOpen,
    setRenameOpen,
    renameValue,
    setRenameValue,
    headerImageOpen,
    setHeaderImageOpen,
    coverImageOpen,
    setCoverImageOpen,
    coverMutation,
    renameImageTarget,
    setRenameImageTarget,
    renameImageValue,
    setRenameImageValue,
    renameImageMutation,
    moveImageTarget,
    setMoveImageTarget,
    moveSelectionOpen,
    setMoveSelectionOpen,
    moveFilter,
    setMoveFilter,
    moveImageMutation,
    moveSelectionMutation,
    moveGalleryOpen,
    setMoveGalleryOpen,
    moveGalleryMutation,
    selection,
    deriveState,
    setDeriveState,
  } = d;

  return (
    <>
      {/* Settings modal */}
      <GallerySettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        gallery={galleryWithChildren}
        initialTab={settingsTab}
      />

      {/* Download dialog (sub-gallery selection; same popup as the public gallery) */}
      {/* Save collection name dialog */}
      <Dialog open={saveCollectionOpen} onOpenChange={setSaveCollectionOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("saveCollectionTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("imagesCount", { count: pendingCollectionIds.length })}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = saveCollectionName.trim();
              if (!name || pendingCollectionIds.length === 0) return;
              createCollectionMutation.mutate({ name, imageIds: pendingCollectionIds });
            }}
            className="space-y-3"
          >
            <Input
              autoFocus
              value={saveCollectionName}
              onChange={(e) => setSaveCollectionName(e.target.value)}
              placeholder={t("collectionNamePlaceholder")}
              maxLength={200}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSaveCollectionOpen(false)}>{tc("cancel")}</Button>
              <Button type="submit" size="sm" disabled={!saveCollectionName.trim() || createCollectionMutation.isPending}>
                {createCollectionMutation.isPending ? tc("saving") : tc("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DownloadGalleryDialog
        galleryName={gallery.name}
        rootCount={images.length}
        subGalleries={children.map((c) => ({ id: c.id, name: c.name, count: c.image_count }))}
        open={downloadOpen}
        onOpenChange={(o) => { setDownloadOpen(o); if (!o) adminZip.setError(null); }}
        onStart={(ids) => adminZip.start(ids, () => setDownloadOpen(false))}
        preparing={adminZip.preparing}
        error={adminZip.error}
        extra={isCollab ? (
          <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
            <p className="text-sm font-medium text-foreground">{t("exportSelections")}</p>
            <p className="text-xs text-muted-foreground">
              {t("exportHint", { count: flagged })}
            </p>
            <div className="flex gap-2">
              <button
                disabled={flagged === 0}
                onClick={() => downloadExport()}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
              >
                <Download size={13} /> {t("filenames")}
              </button>
              <button
                disabled={flagged === 0}
                onClick={() => downloadExport({ include_flag: true })}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
              >
                <Download size={13} /> {t("withFlags")}
              </button>
            </div>
          </div>
        ) : undefined}
      />

      {/* Copy filenames dialog — operates on the currently filtered + sorted grid */}
      <CopyFilenamesDialog
        open={copyNamesOpen}
        onOpenChange={setCopyNamesOpen}
        filenames={filteredSorted.map((img) => img.original_filename)}
        filtered={filterActive || !!activeCollection}
      />

      {/* Share dialog */}
      <ShareDialog gallery={gallery} open={shareOpen} onOpenChange={setShareOpen} />

      {/* Activity dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("activityLog")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <ActivityFeed galleryId={id} embedded />
          </div>
        </DialogContent>
      </Dialog>

      {/* Voting dialog */}
      <Dialog open={votingOpen} onOpenChange={setVotingOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("votingSummary")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <VotingSummary galleryId={id} embedded />
          </div>
        </DialogContent>
      </Dialog>

      {/* Create sub-gallery dialog */}
      <CreateSubGalleryDialog key={createSubOpen ? "createsub-open" : "createsub-closed"} open={createSubOpen} onOpenChange={setCreateSubOpen} parentId={id} parentMode={gallery.mode} />

      {/* Sub-gallery share dialog */}
      {sharingSubId && (() => {
        const sub = children.find((c) => c.id === sharingSubId);
        return sub ? (
          <ShareDialog gallery={sub} open={!!sharingSubId} onOpenChange={(o) => { if (!o) setSharingSubId(null); }} />
        ) : null;
      })()}

      {/* Full-screen image lightbox (same component as the public gallery). adminGalleryId routes
          comments + color flags through the admin-authenticated endpoint (works regardless of
          gallery password). collabMode stays off (presentation chrome, no public likes), but color
          flags are exposed so the photographer can flag while reviewing full-screen — same as the
          grid tiles. */}
      {lightboxOpen && (
        <Lightbox
          downloadsEnabled
          backdrop={adminSettings?.lightbox_backdrop}
          highRes={adminSettings?.high_res_previews ?? false}
          collabMode={false}
          showExif
          showIptc
          adminGalleryId={id}
          features={{ colorFlags: true, likes: false, comments: true, annotations: true }}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteGalleryTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.rich("deleteGalleryBody", { name: gallery.name, b: (c) => <span className="text-foreground font-medium">{c}</span> })}
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)}>{tc("cancel")}</Button>
            <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t("deleting") : t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete collection confirm dialog */}
      <Dialog open={!!deleteCollectionTarget} onOpenChange={(o) => { if (!o) setDeleteCollectionTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteCollectionTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.rich("deleteCollectionBody", { name: deleteCollectionTarget?.name ?? "", b: (c) => <span className="text-foreground font-medium">{c}</span> })}
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteCollectionTarget(null)}>{tc("cancel")}</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteCollectionTarget && deleteCollectionMutation.mutate(deleteCollectionTarget.id)}
              disabled={deleteCollectionMutation.isPending}
            >
              {deleteCollectionMutation.isPending ? t("deleting") : t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Empty gallery confirm dialog */}
      <Dialog open={emptyConfirm} onOpenChange={setEmptyConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("emptyTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("emptyBody")}
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setEmptyConfirm(false)}>{tc("cancel")}</Button>
            <Button size="sm" variant="destructive" onClick={() => emptyMutation.mutate()} disabled={emptyMutation.isPending}>
              {emptyMutation.isPending ? t("clearing") : t("clearGallery")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) updateMutation.mutate({ name: renameValue.trim() });
            }}
            placeholder={t("renamePlaceholder")}
            autoFocus
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>{tc("cancel")}</Button>
            <Button size="sm" onClick={() => updateMutation.mutate({ name: renameValue.trim() })} disabled={!renameValue.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? tc("saving") : t("rename")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename collection dialog */}
      <Dialog open={!!renameCollectionTarget} onOpenChange={(o) => { if (!o) setRenameCollectionTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameCollectionTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameCollectionValue}
            onChange={(e) => setRenameCollectionValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameCollectionTarget && renameCollectionValue.trim())
                updateCollectionMutation.mutate({ collectionId: renameCollectionTarget.id, data: { name: renameCollectionValue.trim() } });
            }}
            placeholder={t("collectionNamePlaceholder")}
            autoFocus
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setRenameCollectionTarget(null)}>{tc("cancel")}</Button>
            <Button
              size="sm"
              onClick={() => renameCollectionTarget && updateCollectionMutation.mutate({ collectionId: renameCollectionTarget.id, data: { name: renameCollectionValue.trim() } })}
              disabled={!renameCollectionValue.trim() || updateCollectionMutation.isPending}
            >
              {updateCollectionMutation.isPending ? tc("saving") : t("rename")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header image dialog */}
      <HeaderImageDialog open={headerImageOpen} onOpenChange={setHeaderImageOpen} gallery={gallery} />
      <CoverImageDialog
        open={coverImageOpen}
        onOpenChange={setCoverImageOpen}
        gallery={gallery}
        images={images}
        onPickPhoto={(imageId) => coverMutation.mutate(imageId)}
        onResetCover={() => coverMutation.mutate(null)}
        picking={coverMutation.isPending}
      />

      {/* Rename image dialog */}
      <Dialog open={!!renameImageTarget} onOpenChange={(o) => { if (!o) setRenameImageTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameFileTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameImageValue}
            onChange={(e) => setRenameImageValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameImageTarget && renameImageValue.trim())
                renameImageMutation.mutate({ imgId: renameImageTarget.id, name: renameImageValue.trim() });
            }}
            placeholder={t("filenamePlaceholder")}
            autoFocus
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setRenameImageTarget(null)}>{tc("cancel")}</Button>
            <Button
              size="sm"
              onClick={() => renameImageTarget && renameImageMutation.mutate({ imgId: renameImageTarget.id, name: renameImageValue.trim() })}
              disabled={!renameImageValue.trim() || renameImageMutation.isPending}
            >
              {renameImageMutation.isPending ? tc("saving") : t("rename")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move dialog — relocates a single image (moveImageTarget) or the whole selection (moveSelectionOpen) */}
      <Dialog
        open={!!moveImageTarget || moveSelectionOpen}
        onOpenChange={(o) => { if (!o) { setMoveImageTarget(null); setMoveSelectionOpen(false); setMoveFilter(""); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moveImageTarget ? t("moveTitle") : t("moveSelectionTitle", { count: selection.count })}
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Input
              value={moveFilter}
              onChange={(e) => setMoveFilter(e.target.value)}
              placeholder={t("filterGalleriesPlaceholder")}
              className="h-8 pr-8 text-sm"
              autoFocus
            />
            {moveFilter && <InputClearButton onClick={() => setMoveFilter("")} label={tc("clear")} />}
          </div>
          {(() => {
            const moveBusy = moveImageMutation.isPending || moveSelectionMutation.isPending;
            const fq = moveFilter.trim().toLowerCase();
            const list = fq ? moveTargets.filter(({ g }) => g.name.toLowerCase().includes(fq)) : moveTargets;
            if (list.length === 0) {
              return <p className="text-sm text-muted-foreground">{t("noGalleriesMatch")}</p>;
            }
            return (
              <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                {list.map(({ g, depth }) => {
                  const isCurrent = g.id === id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => {
                        if (isCurrent) return;
                        if (moveImageTarget) moveImageMutation.mutate({ imgId: moveImageTarget.id, targetId: g.id });
                        else moveSelectionMutation.mutate(g.id);
                      }}
                      disabled={isCurrent || moveBusy}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border text-sm transition-colors",
                        isCurrent ? "border-border bg-muted/40 cursor-default" : "border-border hover:bg-accent disabled:opacity-50",
                      )}
                      style={{ paddingLeft: `${12 + depth * 16}px` }}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {depth > 0 && <CornerDownRight size={12} className="text-muted-foreground/60 shrink-0" />}
                        <span className={cn("font-medium truncate", isCurrent && "text-muted-foreground")}>{g.name}</span>
                        {isCurrent && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                            {t("current")}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs shrink-0">{t("imagesCount", { count: g.image_count })}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => { setMoveImageTarget(null); setMoveSelectionOpen(false); setMoveFilter(""); }}>{tc("cancel")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reparent this whole gallery (with its sub-galleries) — nest it elsewhere or send it to top level */}
      <MoveGalleryDialog
        open={moveGalleryOpen}
        onOpenChange={setMoveGalleryOpen}
        gallery={gallery}
        moveTargets={moveTargets}
        excludedIds={moveExcludedIds}
        onMove={(targetParentId) => moveGalleryMutation.mutate(targetParentId)}
        busy={moveGalleryMutation.isPending}
      />

      {/* Create / copy / move a set of images into a new or existing gallery */}
      <CreateGalleryFromImagesDialog
        key={deriveState?.nonce ?? "derive-closed"}
        open={!!deriveState}
        onOpenChange={(o) => { if (!o) setDeriveState(null); }}
        sourceGalleryId={id}
        sourceGalleryName={gallery.name}
        moveTargets={moveTargets}
        imageIds={deriveState?.imageIds ?? []}
        defaultName={deriveState?.defaultName ?? ""}
        collectionId={deriveState?.collectionId ?? null}
      />

    </>
  );
}
