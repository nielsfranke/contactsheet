// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import type { GlobalSearchResult, OverviewSort } from "@/lib/types";
import { Search, Plus, ArrowUp, ArrowDown, Pin, ScanSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreateGalleryDialog } from "@/components/admin/CreateGalleryDialog";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { ToolbarBand } from "@/components/gallery/ToolbarBand";
import { GRID_COLS, GAP } from "@/lib/gridLayout";
import { cn } from "@/lib/utils";
import { useGalleriesBrowser } from "./useGalleriesBrowser";
import { GalleryTile, TopLevelZone } from "./overview-parts";

const SORT_OPTIONS: { value: OverviewSort; labelKey: string }[] = [
  { value: "created", labelKey: "sortDate" },
  { value: "name", labelKey: "sortName" },
  { value: "photos", labelKey: "sortPhotos" },
];

// "All Photos" browse sort (date added / filename) — a separate axis from the gallery sort.
const PHOTO_SORT_OPTIONS: { value: "date" | "name"; labelKey: string }[] = [
  { value: "date", labelKey: "sortDate" },
  { value: "name", labelKey: "sortName" },
];

export default function GalleriesPage() {
  // useSearchParams must sit under a Suspense boundary (Next prerendering).
  return (
    <Suspense fallback={null}>
      <GalleriesBrowser />
    </Suspense>
  );
}

function GalleriesBrowser() {
  const t = useTranslations("admin.galleries");
  const tc = useTranslations("common");
  const {
    dimId, openGallery,
    visible, pinned, q,
    filter, setFilter, createOpen, setCreateOpen,
    sort, dir, pickSort, togglePin, openRename, setDeleteTarget,
    renameTarget, setRenameTarget, renameValue, setRenameValue, submitRename, renameMutation,
    deleteTarget, deleteMutation,
    size, spacing, tileShape, tileCorners,
    searchEnabled, searchMode, setSearchMode,
    photoQuery, setPhotoQuery, semanticActive, browseFiltered, photoResults, photoLoading, photoError, openResult,
    photoSort, photoDir, pickPhotoSort,
    browseItems, browseTotal, browseLoading, browseFetchingMore, hasMore, loadMore,
  } = useGalleriesBrowser();

  const photoMode = searchMode === "photos";

  // One renderer for both browse + search hits — a thumbnail, a gallery badge, and the filename.
  // Clicking deep-links into the gallery and opens the lightbox at that photo.
  const photoGrid = (items: GlobalSearchResult[]) => (
    <div className={cn("grid items-start", GRID_COLS[size], GAP[spacing])}>
      {items.map((r) => (
        <div key={r.id} className="group">
          <button
            type="button"
            onClick={() => openResult(r)}
            title={`${r.original_filename} · ${r.gallery_name}`}
            className={cn(
              "relative block w-full overflow-hidden border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              tileShape,
              tileCorners,
            )}
          >
            {r.thumb_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.thumb_url}
                alt={r.original_filename}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            )}
            <span className="absolute left-1.5 top-1.5 max-w-[85%] truncate rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
              {r.gallery_name}
            </span>
          </button>
          <p className="mt-1 truncate px-0.5 text-xs text-muted-foreground" title={r.original_filename}>
            {r.original_filename}
          </p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="p-4 sm:p-6">
      {/* Shared header band — same shelf geometry as the in-gallery view's toolbar, so the
          overview and detail pages share one continuous anchor. The overview is the root level;
          opening any gallery goes to its detail page (its sub-galleries + photos). */}
      <ToolbarBand className="sticky top-0 z-20 -mx-4 -mt-4 px-4 sm:-mx-6 sm:-mt-6 sm:px-6 py-2.5 mb-4 sm:mb-6">
        {/* Heading-as-tabs: "All Galleries" (the gallery tree) and "All Photos" (a cross-gallery
            photo browser) are sibling views. The active one reads as the page heading at full
            contrast; the other is a faded, clickable sibling. Kept here, off the search row, so the
            search field never shifts when you switch. */}
        <div className="flex min-w-0 items-center gap-4">
          <h1 className="sr-only">{photoMode ? t("tabPhotos") : t("tabGalleries")}</h1>
          <button
            type="button"
            onClick={() => setSearchMode("galleries")}
            aria-current={!photoMode ? "page" : undefined}
            className={cn(
              "border-b pb-1 text-lg font-semibold transition-colors",
              !photoMode
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("tabGalleries")}
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("photos")}
            aria-current={photoMode ? "page" : undefined}
            className={cn(
              "border-b pb-1 text-lg font-semibold transition-colors",
              photoMode
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("tabPhotos")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="relative w-full sm:w-64">
            {photoMode && searchEnabled ? (
              <ScanSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            ) : (
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            )}
            <Input
              value={photoMode ? photoQuery : filter}
              onChange={(e) => (photoMode ? setPhotoQuery(e.target.value) : setFilter(e.target.value))}
              placeholder={
                photoMode
                  ? searchEnabled
                    ? t("photoSearchPlaceholder")
                    : t("photoFilterPlaceholder")
                  : t("filterGalleries")
              }
              aria-label={
                photoMode
                  ? searchEnabled
                    ? t("photoSearchPlaceholder")
                    : t("photoFilterPlaceholder")
                  : t("filterGalleries")
              }
              className="pl-8 pr-8 h-8 text-sm"
            />
            {photoMode
              ? photoQuery &&
                (photoLoading ? (
                  <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : (
                  <InputClearButton onClick={() => setPhotoQuery("")} label={tc("clear")} />
                ))
              : filter && <InputClearButton onClick={() => setFilter("")} label={tc("clear")} />}
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={15} className="mr-1.5" /> {t("newGallery")}
          </Button>
          {/* Sort — galleries by date/name/photos; All Photos by date/name. Hidden while a photo
              search is active (results are a similarity ranking). */}
          {!photoMode ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("sort")}</span>
              <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                {SORT_OPTIONS.map((o) => {
                  const isActive = o.value === sort;
                  const label = t(o.labelKey);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => pickSort(o.value)}
                      title={isActive ? t("clickToReverse") : t("sortByField", { field: label })}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                        isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                      {isActive && (dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : !semanticActive ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("sort")}</span>
              <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                {PHOTO_SORT_OPTIONS.map((o) => {
                  const isActive = o.value === photoSort;
                  const label = t(o.labelKey);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => pickPhotoSort(o.value)}
                      title={isActive ? t("clickToReverse") : t("sortByField", { field: label })}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                        isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                      {isActive && (photoDir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </ToolbarBand>

      {photoMode ? (
        semanticActive ? (
          /* ── Semantic search narrows the browse to content matches (ranked) ──────────────────── */
          photoError ? (
            <p className="text-muted-foreground text-sm">{t("photoSearchError")}</p>
          ) : photoResults.length === 0 && !photoLoading ? (
            <p className="text-muted-foreground text-sm">{t("photoSearchEmpty")}</p>
          ) : (
            <>
              <p className="mb-4 px-0.5 text-xs text-muted-foreground tabular-nums">
                {t("photoResultCount", { n: photoResults.length })}
              </p>
              {photoGrid(photoResults)}
            </>
          )
        ) : (
          /* ── All Photos: browse (or filename-filter when content search is off), sorted, load-more ── */
          browseItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {browseLoading ? tc("loading") : browseFiltered ? t("photoSearchEmpty") : t("photoBrowseEmpty")}
            </p>
          ) : (
            <>
              <p className="mb-4 px-0.5 text-xs text-muted-foreground tabular-nums">
                {t("photoBrowseCount", { shown: browseItems.length, total: browseTotal })}
              </p>
              {photoGrid(browseItems)}
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => loadMore()} disabled={browseFetchingMore}>
                    {browseFetchingMore && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                    {t("loadMore")}
                  </Button>
                </div>
              )}
            </>
          )
        )
      ) : (
        <>
          {/* Permanent reparent affordance: a "move to top level" drop target + how-to. Always shown
              so it's discoverable and reachable even with a full grid, and never reflows the grid. */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <TopLevelZone />
            <p className="text-xs text-muted-foreground">{t("organizeHint")}</p>
          </div>

          {/* Favorites shelf: every pinned gallery tree-wide, one click from the home view (hidden
              while filtering). */}
          {!q && pinned.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Pin size={13} className="fill-current -rotate-45" /> {t("pinnedShelf")}
              </h2>
              <div className={cn("grid items-start", GRID_COLS[size], GAP[spacing])}>
                {pinned.map((g) => (
                  <GalleryTile
                    key={g.id}
                    g={g}
                    tileShape={tileShape}
                    tileCorners={tileCorners}
                    dimmed={false}
                    onOpen={() => openGallery(g)}
                    onTogglePin={() => togglePin(g)}
                    onRename={() => openRename(g)}
                    onDelete={() => setDeleteTarget(g)}
                  />
                ))}
              </div>
            </section>
          )}

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {q ? t("emptyFilter") : t("emptyRoot")}
            </p>
          ) : (
            <div className={cn("grid items-start", GRID_COLS[size], GAP[spacing])}>
              {visible.map((g) => (
                <GalleryTile
                  key={g.id}
                  g={g}
                  tileShape={tileShape}
                  tileCorners={tileCorners}
                  dimmed={g.id === dimId}
                  onOpen={() => openGallery(g)}
                  onTogglePin={() => togglePin(g)}
                  onRename={() => openRename(g)}
                  onDelete={() => setDeleteTarget(g)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateGalleryDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }}
            placeholder={t("renamePlaceholder")}
            autoFocus
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>{tc("cancel")}</Button>
            <Button size="sm" onClick={submitRename} disabled={!renameValue.trim() || renameMutation.isPending}>
              {renameMutation.isPending ? tc("saving") : t("renameAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog — soft-delete cascades to the whole subtree, so warn when nested. */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.rich("deleteBody", { name: deleteTarget?.name ?? "", b: (c) => <span className="text-foreground font-medium">{c}</span> })}
          </p>
          {!!deleteTarget && deleteTarget.children.length > 0 && (
            <p className="text-sm text-destructive">
              {t("deleteSubWarning", { count: deleteTarget.children.length })}
            </p>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>{tc("cancel")}</Button>
            <Button size="sm" variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t("deleting") : t("deleteAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
