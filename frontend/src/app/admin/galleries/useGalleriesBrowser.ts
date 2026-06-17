// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { GalleryResponse, OverviewSort, SortDir } from "@/lib/types";
import { sortGalleries, NATURAL_SORT_DIR, flattenTree } from "@/lib/gallery-sort";
import { useAdminDndActive } from "@/components/admin/AdminDnd";
import { toast } from "sonner";

/**
 * Controller hook for the galleries overview. The overview is the root level (top-level galleries);
 * opening any gallery goes to its detail page, which is the single "inside a gallery" view (its
 * sub-galleries + photos). Hierarchy navigation/organising lives in the left tree + breadcrumb.
 * The page is a thin consumer that renders the toolbar, the pinned shelf, and the gallery grid.
 */
export function useGalleriesBrowser() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations("admin.galleries");
  const active = useAdminDndActive();
  const dimId = active?.kind === "gallery" ? active.galleryId : null;
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // Organize mode enables drag-to-reparent; off keeps the home clean.
  const [organize, setOrganize] = useState(false);
  // Rename / delete dialogs (per-card actions; the target is the listed gallery).
  const [renameTarget, setRenameTarget] = useState<GalleryResponse | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<GalleryResponse | null>(null);

  const { data: galleries = [] } = useQuery({
    queryKey: ["galleries"],
    queryFn: () => api.galleries.list(),
  });
  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  const size = settings?.overview_size ?? "medium";
  const spacing = settings?.overview_spacing ?? "medium";
  const shape = settings?.overview_shape ?? "square";
  const corners = settings?.overview_corners ?? "round";
  const sort = settings?.overview_sort ?? "created";
  const dir: SortDir = settings?.overview_sort_dir ?? "asc";

  // Persist the sort choice instance-wide (shared with the left nav tree + admin-view settings).
  const sortMutation = useMutation({
    mutationFn: (next: { overview_sort: OverviewSort; overview_sort_dir: SortDir }) =>
      api.adminSettings.update(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-settings"] }),
  });
  // Click a different field → select it in its natural direction; click the active field → flip.
  const pickSort = (field: OverviewSort) =>
    sortMutation.mutate(
      field === sort
        ? { overview_sort: field, overview_sort_dir: dir === "asc" ? "desc" : "asc" }
        : { overview_sort: field, overview_sort_dir: NATURAL_SORT_DIR[field] },
    );

  // Pin/unpin a gallery (admin favorite). Rides PATCH /api/galleries/{id}; refreshes the tree.
  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.galleries.update(id, { pinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["galleries"] }),
  });
  const togglePin = (g: GalleryResponse) => {
    pinMutation.mutate({ id: g.id, pinned: !g.pinned });
    toast(g.pinned ? t("unpinned", { name: g.name }) : t("pinned", { name: g.name }), {
      action: { label: t("undo"), onClick: () => pinMutation.mutate({ id: g.id, pinned: g.pinned }) },
    });
  };

  // Rename a listed gallery in place (no navigation away from the overview).
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.galleries.update(id, { name }),
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setRenameTarget(null);
      toast.success(t("renamed", { name }));
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const openRename = (g: GalleryResponse) => { setRenameValue(g.name); setRenameTarget(g); };
  const submitRename = () => {
    const name = renameValue.trim();
    if (!renameTarget || !name) return;
    renameMutation.mutate({ id: renameTarget.id, name });
  };

  // Delete a listed gallery (soft-delete; cascades to the whole subtree on the backend).
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.galleries.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      const name = deleteTarget?.name ?? "";
      setDeleteTarget(null);
      toast.success(t("deleted", { name }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Every pinned gallery, tree-wide, ordered by the current overview sort — the favorites shelf.
  const pinned = sortGalleries(
    flattenTree(galleries).map((x) => x.g).filter((g) => g.pinned),
    sort,
    dir,
  );

  const q = filter.trim().toLowerCase();
  const visible = sortGalleries(
    q ? galleries.filter((g) => g.name.toLowerCase().includes(q)) : galleries,
    sort,
    dir,
  );

  // One consistent action: open the gallery's detail page (its sub-galleries + photos + tools).
  const openGallery = (g: GalleryResponse) => router.push(`/admin/galleries/${g.id}`);

  const tileShape = shape === "square" ? "aspect-square" : "aspect-[3/2]";
  const tileCorners = corners === "square" ? "rounded-none" : "rounded-lg";

  return {
    // navigation / dnd
    dimId,
    openGallery,
    // listing
    visible,
    pinned,
    q,
    // ui state
    filter,
    setFilter,
    createOpen,
    setCreateOpen,
    organize,
    setOrganize,
    // sort
    sort,
    dir,
    pickSort,
    // actions
    togglePin,
    openRename,
    setDeleteTarget,
    // rename dialog
    renameTarget,
    setRenameTarget,
    renameValue,
    setRenameValue,
    submitRename,
    renameMutation,
    // delete dialog
    deleteTarget,
    deleteMutation,
    // look
    size,
    spacing,
    tileShape,
    tileCorners,
  };
}
