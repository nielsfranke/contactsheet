// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { type DragEndEvent } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAdminDndRegister, useAdminDndActive } from "@/components/admin/AdminDnd";
import { findChildren, findParent, FLAG_GROUP_ORDER, RATING_GROUP_ORDER } from "./parts";
import type { ColorFlag, Collection, GalleryResponse, ImageResponse } from "@/lib/types";
import { compareCaptureDate, hasCaptureDate } from "@/lib/image-sort";
import { flattenTree } from "@/lib/gallery-sort";
import { useImageSelection } from "@/hooks/useImageSelection";
import { useImageUpload } from "@/hooks/useImageUpload";
import { useGalleryRealtime } from "@/hooks/useGalleryRealtime";
import { type ImageGroup } from "@/components/admin/AdminImageGrid";
import { type ArrangeState } from "@/components/admin/GalleryAdminSidebar";
import { type SettingsTab } from "@/components/admin/GallerySettingsModal";
import { useAdminGalleryZip } from "@/hooks/useGalleryZip";
import { useLightboxStore, type LightboxIntent } from "@/store/lightbox";
import { toast } from "sonner";

/**
 * Controller hook for the admin gallery detail page. Owns all data fetching (queries),
 * mutations, the dialog/UI state, the derived memos, and the drag-and-drop registration.
 * The page and its dialog cluster (`GalleryDetailDialogs`) are thin consumers of this.
 */
export function useGalleryDetail(id: string) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations("admin.detail");
  const tf = useTranslations("gallery.flags");
  const ts = useTranslations("gallery.stars");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [coverImageOpen, setCoverImageOpen] = useState(false);
  const [headerImageOpen, setHeaderImageOpen] = useState(false);
  const [renameImageTarget, setRenameImageTarget] = useState<import("@/lib/types").ImageResponse | null>(null);
  const [renameImageValue, setRenameImageValue] = useState("");
  const [moveImageTarget, setMoveImageTarget] = useState<import("@/lib/types").ImageResponse | null>(null);
  const [moveSelectionOpen, setMoveSelectionOpen] = useState(false);
  const [deleteSelectionConfirm, setDeleteSelectionConfirm] = useState(false);
  const [moveFilter, setMoveFilter] = useState("");
  const [moveGalleryOpen, setMoveGalleryOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [copyNamesOpen, setCopyNamesOpen] = useState(false);
  const [copyNamesIncludeSubs, setCopyNamesIncludeSubs] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [votingOpen, setVotingOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [sharingSubId, setSharingSubId] = useState<string | null>(null);

  // Collections
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [saveCollectionOpen, setSaveCollectionOpen] = useState(false);
  const [saveCollectionName, setSaveCollectionName] = useState("");
  const [pendingCollectionIds, setPendingCollectionIds] = useState<string[]>([]);
  const [deleteCollectionTarget, setDeleteCollectionTarget] = useState<Collection | null>(null);
  const [renameCollectionTarget, setRenameCollectionTarget] = useState<Collection | null>(null);
  const [renameCollectionValue, setRenameCollectionValue] = useState("");

  // "Create / copy / move into a gallery" — the source set of images (from a collection, the
  // active filter, or a manual selection) for the CreateGalleryFromImagesDialog.
  const [deriveState, setDeriveState] = useState<
    { imageIds: string[]; defaultName: string; collectionId: string | null; nonce: number } | null
  >(null);

  const { open: openLightbox, isOpen: lightboxOpen } = useLightboxStore();
  const adminZip = useAdminGalleryZip(id);

  const [arrange, setArrange] = useState<ArrangeState>({
    filterName: "",
    flagFilters: new Set<ColorFlag>(),
    ratingFilters: new Set<number>(),
    commentsOnly: false,
    sortKey: "manual",
    sortAsc: true,
    groupKey: "none",
  });

  const sortSeededRef = useRef(false);

  // Semantic content search (opt-in feature). When a query is active, the photo grid shows
  // server-ranked results instead of the client-side filtered/sorted list.
  const [searchQuery, setSearchQuery] = useState("");

  const { data: gallery, isLoading } = useQuery({
    queryKey: ["gallery", id],
    queryFn: () => api.galleries.get(id),
    enabled: !!id,
  });

  const { data: galleries = [] } = useQuery({
    queryKey: ["galleries"],
    queryFn: () => api.galleries.list(),
  });
  const { data: adminSettings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  // Sticky sort: seed the in-gallery sort from the instance-wide default (gallery_sort) once, then
  // write it back whenever it changes so the next gallery opens on the same choice.
  useEffect(() => {
    if (adminSettings && !sortSeededRef.current) {
      sortSeededRef.current = true;
      setArrange((a) => ({
        ...a,
        sortKey: adminSettings.gallery_sort,
        sortAsc: adminSettings.gallery_sort_dir !== "desc",
      }));
    }
  }, [adminSettings]);
  useEffect(() => {
    if (!sortSeededRef.current || !adminSettings) return;
    // "rating" is a transient, stars-mode-only sort — never persist it as the instance default.
    if (arrange.sortKey === "rating") return;
    const dir = arrange.sortAsc ? "asc" : "desc";
    if (arrange.sortKey === adminSettings.gallery_sort && dir === adminSettings.gallery_sort_dir) return;
    api.adminSettings
      .update({ gallery_sort: arrange.sortKey, gallery_sort_dir: dir })
      .then((updated) => qc.setQueryData(["admin-settings"], updated))
      .catch(() => {});
  }, [arrange.sortKey, arrange.sortAsc, adminSettings, qc]);

  const children = useMemo(() => findChildren(galleries, id) ?? [], [galleries, id]);
  // The whole gallery tree (depth-tagged) for the "Move Image" picker; the current one is flagged.
  const moveTargets = useMemo(() => flattenTree(galleries), [galleries]);
  // Destinations the "Move gallery" picker must hide: the gallery itself and every descendant —
  // reparenting into one would create a cycle (the backend rejects it too).
  const moveExcludedIds = useMemo(() => {
    const ids = new Set<string>([id]);
    const self = moveTargets.find(({ g }) => g.id === id)?.g;
    const collect = (g: GalleryResponse) => g.children.forEach((c) => { ids.add(c.id); collect(c); });
    if (self) collect(self);
    return ids;
  }, [moveTargets, id]);
  const parentGallery = useMemo(() => findParent(galleries, id) ?? null, [galleries, id]);
  const siblings = useMemo(() => parentGallery?.children ?? [], [parentGallery]);

  const { data: images = [], refetch: refetchImages } = useQuery({
    queryKey: ["gallery-images", id],
    queryFn: () => api.galleries.images(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const hasPending = query.state.data?.some((img) => img.processing_status === "pending");
      return hasPending ? 3000 : false;
    },
  });

  const upload = useImageUpload(id, refetchImages);

  // Semantic search: only available when the instance has the feature on. The query is debounced
  // implicitly by react-query's keying — each settled term is fetched once and cached.
  const searchEnabled = adminSettings?.semantic_search?.enabled ?? false;
  const searchTerm = searchQuery.trim();
  const searchActive = searchEnabled && searchTerm.length > 0;
  const {
    data: searchResults,
    isFetching: searchLoading,
    isError: searchError,
  } = useQuery({
    queryKey: ["gallery-search", id, searchTerm],
    queryFn: () => api.galleries.search(id, searchTerm),
    enabled: !!id && searchActive,
    placeholderData: (prev) => prev,
  });

  // Live updates: refresh photos/comments/votes/collections as clients act in this gallery.
  useGalleryRealtime({ kind: "admin", adminGalleryId: id });

  const { data: collections = [] } = useQuery({
    queryKey: ["collections", id],
    queryFn: () => api.galleries.listCollections(id),
    enabled: !!id,
  });

  const createCollectionMutation = useMutation({
    mutationFn: ({ name, imageIds }: { name: string; imageIds: string[] }) =>
      api.galleries.createCollection(id, name, imageIds),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["collections", id] });
      selection.setMode(false);
      setSaveCollectionOpen(false);
      setSaveCollectionName("");
      toast.success(t("toast.collectionSaved", { name: c.name, count: c.image_count }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: (collectionId: string) => api.galleries.deleteCollection(id, collectionId),
    onSuccess: (_d, collectionId) => {
      qc.invalidateQueries({ queryKey: ["collections", id] });
      setActiveCollection((cur) => (cur === collectionId ? null : cur));
      setDeleteCollectionTarget(null);
      toast.success(t("toast.collectionDeleted"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateCollectionMutation = useMutation({
    mutationFn: ({ collectionId, data }: { collectionId: string; data: { name?: string; image_ids?: string[] } }) =>
      api.galleries.updateCollection(id, collectionId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections", id] });
      setRenameCollectionTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Membership edits operate on the active collection's current ordered ids.
  function activeCollectionObj(): Collection | undefined {
    return collections.find((c) => c.id === activeCollection);
  }
  function addSelectionToCollection() {
    const c = activeCollectionObj();
    if (!c) return;
    const merged = [...c.image_ids, ...[...selection.selected].filter((iid) => !c.image_ids.includes(iid))];
    if (merged.length === c.image_ids.length) return;
    updateCollectionMutation.mutate({ collectionId: c.id, data: { image_ids: merged } });
    selection.clear();
  }
  function removeFromCollection(imageId: string) {
    const c = activeCollectionObj();
    if (!c) return;
    const next = c.image_ids.filter((iid) => iid !== imageId);
    if (next.length === 0) {
      toast.error(t("toast.collectionLastImage"));
      return;
    }
    updateCollectionMutation.mutate({ collectionId: c.id, data: { image_ids: next } });
  }

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.galleries.update>[1]) => api.galleries.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setSettingsOpen(false);
      setRenameOpen(false);
      toast.success(t("toast.galleryUpdated"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.galleries.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      toast.success(t("toast.galleryDeleted"));
      router.push("/admin");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const emptyMutation = useMutation({
    mutationFn: () => api.galleries.empty(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["gallery-images", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setEmptyConfirm(false);
      toast.success(t("toast.galleryCleared"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const coverMutation = useMutation({
    mutationFn: (imageId: string | null) => api.galleries.setCover(id, imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setCoverImageOpen(false);
      toast.success(t("toast.coverUpdated"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renameImageMutation = useMutation({
    mutationFn: ({ imgId, name }: { imgId: string; name: string }) =>
      api.images.update(imgId, { original_filename: name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery-images", id] });
      setRenameImageTarget(null);
      toast.success(t("toast.fileRenamed"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const moveImageMutation = useMutation({
    mutationFn: ({ imgId, targetId }: { imgId: string; targetId: string }) =>
      api.images.move(imgId, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery-images"] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setMoveImageTarget(null);
      toast.success(t("toast.imageMoved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk move: relocate every currently selected image into the chosen gallery, then exit
  // select mode. Sequential so a failure stops cleanly and surfaces one error.
  const moveSelectionMutation = useMutation({
    mutationFn: async (targetId: string) => {
      const ids = [...selection.selected];
      for (const imgId of ids) await api.images.move(imgId, targetId);
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["gallery-images"] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setMoveSelectionOpen(false);
      setMoveFilter("");
      selection.clear();
      selection.setMode(false);
      toast.success(t("toast.imagesMoved", { count }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk delete: soft-delete every currently selected image, then exit select mode. Sequential so
  // a failure stops cleanly and surfaces one error (mirrors the bulk-move pattern).
  const deleteSelectionMutation = useMutation({
    mutationFn: async () => {
      const ids = [...selection.selected];
      for (const imgId of ids) await api.images.delete(imgId);
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["gallery-images", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setDeleteSelectionConfirm(false);
      selection.clear();
      selection.setMode(false);
      toast.success(t("toast.imagesDeleted", { count }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Reparent this whole gallery (with its sub-galleries). targetParentId === null → top level.
  const moveGalleryMutation = useMutation({
    mutationFn: (targetParentId: string | null) => api.galleries.move(id, targetParentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setMoveGalleryOpen(false);
      toast.success(t("toast.galleryMoved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setHeaderFromImageMutation = useMutation({
    mutationFn: (imageId: string) => api.galleries.setHeaderImageFromGalleryImage(id, imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", id] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setHeaderImageOpen(true);
      toast.success(t("toast.headerUpdated"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openSettings(tab: SettingsTab = "general") {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }
  function downloadExport(options?: { include_flag?: boolean }) {
    if (!gallery) return;
    const a = document.createElement("a");
    a.href = api.galleries.exportUrl(id, options);
    a.download = `selections-${gallery.name.replace(/[^a-z0-9]/gi, "_")}.txt`;
    a.click();
  }

  // Filter → sort → (group)
  const flagged = images.filter((img) => img.color_flag !== "none").length;
  // "Capture Date" sort is only offered when at least one photo carries EXIF capture metadata;
  // without it the sort falls back to filename so the order is still meaningful.
  const captureSortAvailable = useMemo(() => images.some(hasCaptureDate), [images]);

  // Portable per-image filters (name / flag / rating / comments) — the subset that can be
  // re-applied across a subtree for "include subgalleries". Collection membership and semantic
  // search ranking are per-gallery and intentionally excluded.
  const matchesPortableFilter = useMemo(() => {
    const q = arrange.filterName.trim().toLowerCase();
    return (img: ImageResponse) => {
      if (q && !img.original_filename.toLowerCase().includes(q)) return false;
      if (arrange.flagFilters.size > 0 && !arrange.flagFilters.has(img.color_flag)) return false;
      if (arrange.ratingFilters.size > 0 && !arrange.ratingFilters.has(img.rating)) return false;
      if (arrange.commentsOnly && img.comment_count === 0) return false;
      return true;
    };
  }, [arrange]);

  const filteredSorted = useMemo(() => {
    // Search mode wins: show the server's similarity ranking as-is (no client filter/sort/group).
    if (searchActive) return searchResults ?? [];

    let list = images.filter(matchesPortableFilter);
    if (activeCollection) {
      const member = new Set(collections.find((c) => c.id === activeCollection)?.image_ids ?? []);
      list = list.filter((img) => member.has(img.id));
    }

    const dir = arrange.sortAsc ? 1 : -1;
    const sortKey = arrange.sortKey === "captured" && !captureSortAvailable ? "filename" : arrange.sortKey;
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case "filename": return a.original_filename.localeCompare(b.original_filename) * dir;
        case "date": return (a.created_at < b.created_at ? -1 : 1) * dir;
        case "captured": return compareCaptureDate(a, b, dir);
        case "rating": return (a.rating - b.rating) * dir;
        default: return (a.sort_order - b.sort_order) * dir;
      }
    });
    return sorted;
  }, [images, matchesPortableFilter, arrange, activeCollection, collections, captureSortAvailable, searchActive, searchResults]);

  const visibleIds = useMemo(() => filteredSorted.map((img) => img.id), [filteredSorted]);
  const selection = useImageSelection(visibleIds);

  // "Copy filenames" → optionally fold in every descendant gallery's photos. The subtree images
  // are fetched lazily (only while the dialog is open with the option on) and run through the same
  // portable filter, so "selects" extend across the whole tree. Per-gallery views (an active
  // collection or a semantic search) can't be extended, so the option is suppressed there.
  const descendantIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (gs: GalleryResponse[]) => gs.forEach((g) => { ids.push(g.id); walk(g.children); });
    walk(children);
    return ids;
  }, [children]);
  const copySubsAvailable = descendantIds.length > 0 && !searchActive && !activeCollection;
  const subImageQueries = useQueries({
    queries:
      copyNamesOpen && copyNamesIncludeSubs && copySubsAvailable
        ? descendantIds.map((gid) => ({
            queryKey: ["gallery-images", gid],
            queryFn: () => api.galleries.images(gid),
            staleTime: 30_000,
          }))
        : [],
  });
  const copySubsLoading = subImageQueries.some((q) => q.isLoading);
  const copyExportImages = useMemo(() => {
    if (!copyNamesIncludeSubs || !copySubsAvailable) return filteredSorted;
    const subs = subImageQueries.flatMap((q) => q.data ?? []).filter(matchesPortableFilter);
    return [...filteredSorted, ...subs];
  }, [copyNamesIncludeSubs, copySubsAvailable, filteredSorted, subImageQueries, matchesPortableFilter]);

  // Entry points for "create / copy / move into a gallery". Each seeds the dialog with a set of
  // image ids + a sensible default name; a single active color flag names the filter set.
  const startGalleryFromCollection = (c: Collection) =>
    setDeriveState({ imageIds: c.image_ids, defaultName: c.name, collectionId: c.id, nonce: Date.now() });
  const startGalleryFromFilter = () => {
    const single =
      arrange.flagFilters.size === 1 && !arrange.filterName.trim() && !arrange.commentsOnly
        ? tf([...arrange.flagFilters][0])
        : "";
    setDeriveState({ imageIds: visibleIds, defaultName: single, collectionId: null, nonce: Date.now() });
  };
  const startGalleryFromSelection = () =>
    setDeriveState({ imageIds: [...selection.selected], defaultName: "", collectionId: null, nonce: Date.now() });

  const groups: ImageGroup[] | undefined = useMemo(() => {
    // No grouping while searching — ranked results render as one flat, ordered list.
    if (searchActive) return undefined;
    if (arrange.groupKey === "flag") {
      return FLAG_GROUP_ORDER
        .map((value) => ({
          key: value as string,
          label: tf(value),
          images: filteredSorted.filter((img: ImageResponse) => img.color_flag === value),
        }))
        .filter((g) => g.images.length > 0);
    }
    if (arrange.groupKey === "rating") {
      return RATING_GROUP_ORDER
        .map((value) => ({
          key: `rating:${value}`,
          label: value === 0 ? ts("unrated") : ts("nStars", { count: value }),
          images: filteredSorted.filter((img: ImageResponse) => img.rating === value),
        }))
        .filter((g) => g.images.length > 0);
    }
    return undefined;
  }, [filteredSorted, arrange.groupKey, tf, ts, searchActive]);

  // Admin photo-grid look: mirror the gallery's client settings (WYSIWYG), unless the instance is
  // set to a custom admin-view override, in which case use that (per-field built-in fallback).
  const adminGrid = useMemo(() => {
    if (!gallery) return null;
    const ov = adminSettings?.admin_grid_mode === "custom" ? adminSettings.admin_grid_view ?? {} : null;
    return {
      layout: ov?.layout ?? gallery.layout,
      presentation: ov
        ? {
            previewSize: ov.preview_size ?? "medium",
            previewSpacing: ov.preview_spacing ?? "medium",
            previewCorners: ov.preview_corners ?? "round",
          }
        : {
            previewSize: gallery.preview_size,
            previewSpacing: gallery.preview_spacing,
            previewCorners: gallery.preview_corners,
          },
    };
  }, [gallery, adminSettings]);

  // Ordered, displayable list the lightbox traverses, matching the on-screen display order.
  // "no_preview" tiles (e.g. PSB without a thumbnail) are included so they're navigable.
  const lightboxList = useMemo(() => {
    const order = groups ? groups.flatMap((g) => g.images) : filteredSorted;
    return order.filter(
      (img) => img.processing_status === "done" || img.processing_status === "no_preview",
    );
  }, [groups, filteredSorted]);

  function openPreview(img: ImageResponse, intent?: LightboxIntent) {
    const idx = lightboxList.findIndex((x) => x.id === img.id);
    if (idx >= 0) openLightbox(lightboxList, idx, intent);
  }

  const filterActive =
    arrange.filterName.trim() !== "" || arrange.flagFilters.size > 0 || arrange.commentsOnly;
  function handleDownload() {
    // Active filter → download exactly the visible photos. Otherwise open the sub-gallery picker.
    if (filterActive) adminZip.startImages(lightboxList.map((i) => i.id));
    else setDownloadOpen(true);
  }

  // ---- Drag-and-drop: move photos onto sub-gallery cards / nav folders; reorder on manual sort ----
  // The DndContext itself lives in the admin layout (so it also covers the portalled sidebar); we
  // register this page's handlers into it.
  const registerDnd = useAdminDndRegister();
  const activeDrag = useAdminDndActive();
  const activeDragId = activeDrag?.kind === "image" ? activeDrag.id : null;

  const reorderMutation = useMutation({
    mutationFn: (imageIds: string[]) => api.galleries.reorder(id, imageIds),
    onError: (err: Error) => toast.error(err.message),
  });

  // Move one or many photos into another gallery via drag-and-drop. Sequential so a failure
  // surfaces cleanly; a single toast + undo covers the whole batch.
  const dndMoveImages = useMutation({
    mutationFn: async ({ imgIds, targetId }: { imgIds: string[]; targetId: string }) => {
      for (const imgId of imgIds) await api.images.move(imgId, targetId);
      return imgIds;
    },
    onSuccess: (imgIds) => {
      // Refresh every gallery's image list — the source AND the destination (so the photos show
      // up there without a manual refresh).
      qc.invalidateQueries({ queryKey: ["gallery-images"] });
      qc.invalidateQueries({ queryKey: ["galleries"] });
      const count = imgIds.length;
      toast.success(count > 1 ? t("toast.photosMoved", { count }) : t("toast.photoMoved"), {
        action: {
          label: t("undo"),
          onClick: () =>
            Promise.all(imgIds.map((iid) => api.images.move(iid, id))).then(() => {
              qc.invalidateQueries({ queryKey: ["gallery-images"] });
              qc.invalidateQueries({ queryKey: ["galleries"] });
            }),
        },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    if (!e.over) return;
    const targetId = e.over.data.current?.galleryId as string | undefined;
    if (targetId) {
      if (targetId !== id) {
        // Dragging one of the selected photos moves the whole selection; dragging any other photo
        // (or when not selecting) moves just that one.
        const dragSelection = selection.mode && selection.selected.has(activeId);
        const imgIds = dragSelection ? [...selection.selected] : [activeId];
        dndMoveImages.mutate({ imgIds, targetId });
        if (dragSelection) { selection.clear(); selection.setMode(false); }
      }
      return;
    }
    const overId = String(e.over.id);
    // Reorder (manual sort, ungrouped) when dropped on another tile.
    if (arrange.sortKey === "manual" && !groups && activeId !== overId) {
      const oldIndex = filteredSorted.findIndex((img) => img.id === activeId);
      const newIndex = filteredSorted.findIndex((img) => img.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...filteredSorted];
      reordered.splice(newIndex, 0, reordered.splice(oldIndex, 1)[0]);
      const newIds = reordered.map((img) => img.id);
      qc.setQueryData<ImageResponse[]>(["gallery-images", id], (prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.map((img) => [img.id, img]));
        return newIds.map((iid, i) => ({ ...byId.get(iid)!, sort_order: i }));
      });
      reorderMutation.mutate(newIds);
    }
  }

  // Keep live refs so the registered config (handler + image overlay) can stay stable.
  const dragEndRef = useRef(handleDragEnd);
  const overlayRef = useRef<(activeId: string) => ReactNode>(() => null);
  useEffect(() => {
    dragEndRef.current = handleDragEnd;
    overlayRef.current = (activeId: string) => {
      const img = images.find((i) => i.id === activeId);
      if (!img?.thumb_url) return null;
      // Dragging a selected photo carries the whole selection — show how many travel along.
      const count = selection.mode && selection.selected.has(activeId) ? selection.count : 1;
      return (
        <div className="relative w-40">
          {count > 1 && (
            <>
              {/* Stacked-cards hint behind the thumb */}
              <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-sm bg-muted shadow-xl" />
              <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-sm bg-muted shadow-xl" />
            </>
          )}
          <div className="relative overflow-hidden rounded-sm shadow-2xl opacity-90">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.thumb_url} alt="" className="w-full h-auto" />
          </div>
          {count > 1 && (
            <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shadow-lg">
              {count}
            </span>
          )}
        </div>
      );
    };
  });
  useEffect(() => {
    registerDnd({
      onDragEnd: (e) => dragEndRef.current(e),
      renderOverlay: (activeId) => overlayRef.current(activeId),
    });
    return () => registerDnd(null);
  }, [registerDnd]);

  return {
    // identity
    id,
    // data
    gallery,
    isLoading,
    adminSettings,
    children,
    moveTargets,
    moveExcludedIds,
    parentGallery,
    siblings,
    images,
    refetchImages,
    upload,
    collections,
    // derived
    flagged,
    filteredSorted,
    captureSortAvailable,
    visibleIds,
    selection,
    groups,
    adminGrid,
    lightboxList,
    filterActive,
    activeDragId,
    // arrange
    arrange,
    setArrange,
    // semantic search
    searchEnabled,
    searchQuery,
    setSearchQuery,
    searchActive,
    searchLoading,
    searchError,
    // dialog/UI state
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    deleteConfirm,
    setDeleteConfirm,
    emptyConfirm,
    setEmptyConfirm,
    renameOpen,
    setRenameOpen,
    renameValue,
    setRenameValue,
    coverImageOpen,
    setCoverImageOpen,
    headerImageOpen,
    setHeaderImageOpen,
    renameImageTarget,
    setRenameImageTarget,
    renameImageValue,
    setRenameImageValue,
    moveImageTarget,
    setMoveImageTarget,
    moveSelectionOpen,
    setMoveSelectionOpen,
    deleteSelectionConfirm,
    setDeleteSelectionConfirm,
    moveFilter,
    setMoveFilter,
    moveGalleryOpen,
    setMoveGalleryOpen,
    downloadOpen,
    setDownloadOpen,
    copyNamesOpen,
    setCopyNamesOpen,
    copyExportImages,
    copyNamesIncludeSubs,
    setCopyNamesIncludeSubs,
    copySubsAvailable,
    copySubsLoading,
    subGalleryCount: descendantIds.length,
    activityOpen,
    setActivityOpen,
    votingOpen,
    setVotingOpen,
    shareOpen,
    setShareOpen,
    createSubOpen,
    setCreateSubOpen,
    sharingSubId,
    setSharingSubId,
    // collections state
    activeCollection,
    setActiveCollection,
    saveCollectionOpen,
    setSaveCollectionOpen,
    saveCollectionName,
    setSaveCollectionName,
    pendingCollectionIds,
    setPendingCollectionIds,
    deleteCollectionTarget,
    setDeleteCollectionTarget,
    renameCollectionTarget,
    setRenameCollectionTarget,
    renameCollectionValue,
    setRenameCollectionValue,
    addSelectionToCollection,
    removeFromCollection,
    // create / copy / move into a gallery
    deriveState,
    setDeriveState,
    startGalleryFromCollection,
    startGalleryFromFilter,
    startGalleryFromSelection,
    // lightbox + zip
    lightboxOpen,
    adminZip,
    // handlers
    openSettings,
    downloadExport,
    openPreview,
    handleDownload,
    // mutations
    createCollectionMutation,
    deleteCollectionMutation,
    updateCollectionMutation,
    updateMutation,
    deleteMutation,
    emptyMutation,
    coverMutation,
    renameImageMutation,
    moveImageMutation,
    moveSelectionMutation,
    deleteSelectionMutation,
    moveGalleryMutation,
    setHeaderFromImageMutation,
  };
}

export type GalleryDetail = ReturnType<typeof useGalleryDetail>;
