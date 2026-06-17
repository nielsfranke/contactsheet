// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import type { OverviewSort } from "@/lib/types";
import { Search, Plus, FolderTree, ArrowUp, ArrowDown, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreateGalleryDialog } from "@/components/admin/CreateGalleryDialog";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { ToolbarBand } from "@/components/gallery/ToolbarBand";
import { GRID_COLS, GAP } from "@/lib/gridLayout";
import { cn } from "@/lib/utils";
import { useGalleriesBrowser } from "./useGalleriesBrowser";
import { TopLevelZone, GalleryTile } from "./overview-parts";

const SORT_OPTIONS: { value: OverviewSort; labelKey: string }[] = [
  { value: "created", labelKey: "sortDate" },
  { value: "name", labelKey: "sortName" },
  { value: "photos", labelKey: "sortPhotos" },
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
  const tShell = useTranslations("admin.shell");
  const {
    dimId, openGallery,
    visible, pinned, q,
    filter, setFilter, createOpen, setCreateOpen, organize, setOrganize,
    sort, dir, pickSort, togglePin, openRename, setDeleteTarget,
    renameTarget, setRenameTarget, renameValue, setRenameValue, submitRename, renameMutation,
    deleteTarget, deleteMutation,
    size, spacing, tileShape, tileCorners,
  } = useGalleriesBrowser();

  return (
    <div className="p-4 sm:p-6">
      {/* Shared header band — same shelf geometry as the in-gallery view's toolbar, so the
          overview and detail pages share one continuous anchor. The overview is the root level;
          opening any gallery goes to its detail page (its sub-galleries + photos). */}
      <ToolbarBand className="sticky top-0 z-20 -mx-4 -mt-4 px-4 sm:-mx-6 sm:-mt-6 sm:px-6 py-2.5 mb-4 sm:mb-6">
        <h1 className="min-w-0 truncate text-xl font-semibold text-foreground">{tShell("allGalleries")}</h1>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("filterGalleries")}
              className="pl-8 pr-8 h-8 text-sm"
            />
            {filter && <InputClearButton onClick={() => setFilter("")} label={tc("clear")} />}
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={15} className="mr-1.5" /> {t("newGallery")}
          </Button>
          <Button
            size="sm"
            variant={organize ? "default" : "outline"}
            onClick={() => setOrganize((v) => !v)}
            title={t("organizeTitle")}
          >
            <FolderTree size={15} className="mr-1.5" /> {organize ? t("done") : t("organize")}
          </Button>
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
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {isActive && (dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </ToolbarBand>

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
                organize={false}
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

      {organize && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <TopLevelZone />
          <p className="text-xs text-muted-foreground">
            {t("organizeHint")}
          </p>
        </div>
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
              organize={organize}
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
