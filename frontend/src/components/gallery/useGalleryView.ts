// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getErrorCode } from "@/lib/api";
import type { ColorFlag, GalleryPublicResponse, ImageResponse } from "@/lib/types";
import { type ToolbarArrange as ArrangeState } from "./GalleryToolbar";
import { resolveOpenerFont } from "@/lib/gallery-fonts";
import { compareCaptureDate } from "@/lib/image-sort";
import { useGalleryZip } from "@/hooks/useGalleryZip";
import { useGalleryRealtime } from "@/hooks/useGalleryRealtime";
import { useImageSelection } from "@/hooks/useImageSelection";
import { useLightboxStore } from "@/store/lightbox";
import { useReviewerStore } from "@/store/reviewer";

export const FLAG_GROUP_ORDER: ColorFlag[] = ["green", "red", "yellow", "blue", "none"];

/**
 * Controller hook for the public gallery viewer. Owns all data fetching, collaboration state,
 * derived memos and handlers. The `GalleryView` orchestrator and its two layout components
 * (`GalleryCollabLayout` / `GalleryPresentationLayout`) are thin consumers of this view-model.
 */
export function useGalleryView(
  gallery: GalleryPublicResponse,
  shareToken: string,
  galleryToken?: string,
) {
  const t = useTranslations("gallery");
  const te = useTranslations("errors");
  const photosRef = useRef<HTMLElement>(null);
  const collabMode = gallery.mode === "collaboration";
  const teamVoting = collabMode && gallery.enable_team_voting;
  const watermarkEnabled = gallery.watermark_enabled;
  const reviewerName = useReviewerStore((s) => s.name);
  const qc = useQueryClient();
  const [showPrompt, setShowPrompt] = useState(teamVoting && !reviewerName);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false); // mobile collaboration sidebar drawer
  const zip = useGalleryZip(shareToken, galleryToken);
  // Initial sort seeds from the instance-wide default (Settings → gallery_sort); the client can
  // re-sort locally for their session but never writes back.
  const [arrange, setArrange] = useState<ArrangeState>({
    filterName: "",
    flagFilters: new Set<ColorFlag>(),
    commentsOnly: false,
    sortKey: gallery.default_sort,
    sortAsc: gallery.default_sort_dir !== "desc",
    groupKey: "none",
  });
  const collectionsEnabled = gallery.sets_enabled;
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [saveCollectionName, setSaveCollectionName] = useState<string | null>(null); // non-null = dialog open
  const [pendingCollectionIds, setPendingCollectionIds] = useState<string[]>([]);

  const bright = gallery.bg_brightness === "bright";
  const openerFont = resolveOpenerFont(gallery.opener_font);
  // Collaboration features gated by per-gallery toggles. Presentation mode is delivery-only —
  // no flags/likes/comments — so everything collapses to false there.
  const features = {
    colorFlags: collabMode && gallery.color_flags_enabled,
    likes: collabMode && gallery.likes_enabled,
    comments: collabMode && gallery.comments_enabled,
    annotations: collabMode && gallery.comments_enabled && gallery.annotations_enabled,
  };
  const presentation = {
    previewSize: gallery.preview_size,
    previewSpacing: gallery.preview_spacing,
    previewCorners: gallery.preview_corners,
    showFilename: gallery.show_filename,
    bright,
    highRes: gallery.high_res_previews,
  };

  const { data: rawImages = [], isLoading } = useQuery({
    queryKey: ["public-images", shareToken, galleryToken],
    queryFn: () => api.public.images(shareToken, galleryToken),
  });

  // Live updates: refresh on comments/flags/votes/collections/uploads from any other viewer.
  useGalleryRealtime({ kind: "public", shareToken, galleryToken: galleryToken ?? null });

  const { data: votes = [] } = useQuery({
    queryKey: ["public-votes", shareToken, reviewerName],
    queryFn: () => api.public.getVotes(shareToken, reviewerName!, galleryToken),
    enabled: teamVoting && !!reviewerName,
  });

  // Per-reviewer likes (one like per person). The set drives the filled-when-mine heart.
  const { data: likedIds = [] } = useQuery({
    queryKey: ["public-likes", shareToken, reviewerName],
    queryFn: () => api.public.getLikes(shareToken, reviewerName!, galleryToken),
    enabled: features.likes && !!reviewerName,
  });
  const likedSet = useMemo(() => new Set(likedIds), [likedIds]);

  function toggleLike(imageId: string) {
    if (!reviewerName) {
      setShowPrompt(true); // need a name to dedupe the like — re-tap after confirming
      return;
    }
    // Optimistically flip the liked set so the heart responds instantly.
    qc.setQueryData<string[]>(["public-likes", shareToken, reviewerName], (prev = []) =>
      prev.includes(imageId) ? prev.filter((id) => id !== imageId) : [...prev, imageId],
    );
    api.public
      .likeImage(shareToken, imageId, reviewerName, galleryToken)
      .then(() => qc.invalidateQueries({ queryKey: ["public-images"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["public-likes", shareToken, reviewerName] }));
  }

  const { data: collections = [] } = useQuery({
    queryKey: ["public-collections", shareToken, galleryToken],
    queryFn: () => api.public.collections(shareToken, galleryToken),
    enabled: collectionsEnabled,
  });

  const createCollectionMutation = useMutation({
    mutationFn: ({ name, imageIds }: { name: string; imageIds: string[] }) =>
      api.public.createCollection(shareToken, name, imageIds, reviewerName ?? "Guest", galleryToken),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["public-collections", shareToken, galleryToken] });
      selection.setMode(false);
      setSaveCollectionName(null);
      toast.success(t("collections.saved", { name: c.name }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function errMsg(err: unknown): string {
    const code = getErrorCode(err);
    if (code && te.has(code)) return te(code);
    return err instanceof Error ? err.message : t("collections.actionFailed");
  }

  const deleteCollectionMutation = useMutation({
    mutationFn: (collectionId: string) =>
      api.public.deleteCollection(shareToken, collectionId, reviewerName ?? "Guest", galleryToken),
    onSuccess: (_d, collectionId) => {
      qc.invalidateQueries({ queryKey: ["public-collections", shareToken, galleryToken] });
      setActiveCollection((cur) => (cur === collectionId ? null : cur));
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const renameCollectionMutation = useMutation({
    mutationFn: ({ collectionId, name }: { collectionId: string; name: string }) =>
      api.public.updateCollection(shareToken, collectionId, { name, actor: reviewerName ?? "Guest" }, galleryToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["public-collections", shareToken, galleryToken] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const votesByImageId = useMemo(
    () => Object.fromEntries(votes.map((v) => [v.image_id, v.color_flag])),
    [votes],
  );

  // In team voting the displayed flag is the reviewer's vote, otherwise the stored image flag.
  const flagOf = useMemo(
    () => (img: ImageResponse): ColorFlag =>
      teamVoting ? ((votesByImageId[img.id] as ColorFlag) ?? "none") : img.color_flag,
    [teamVoting, votesByImageId],
  );

  // Filter → sort.
  const filteredSorted = useMemo(() => {
    let list = rawImages;
    const q = arrange.filterName.trim().toLowerCase();
    if (q) list = list.filter((img) => img.original_filename.toLowerCase().includes(q));
    if (arrange.flagFilters.size > 0) list = list.filter((img) => arrange.flagFilters.has(flagOf(img)));
    if (arrange.commentsOnly) list = list.filter((img) => img.comment_count > 0);
    if (activeCollection) {
      const member = new Set(collections.find((c) => c.id === activeCollection)?.image_ids ?? []);
      list = list.filter((img) => member.has(img.id));
    }

    const dir = arrange.sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (arrange.sortKey) {
        case "filename": return a.original_filename.localeCompare(b.original_filename) * dir;
        case "date": return (a.created_at < b.created_at ? -1 : 1) * dir;
        case "captured": return compareCaptureDate(a, b, dir);
        default: return (a.sort_order - b.sort_order) * dir;
      }
    });
  }, [rawImages, arrange, flagOf, activeCollection, collections]);

  const visibleIds = useMemo(() => filteredSorted.map((img) => img.id), [filteredSorted]);
  const selection = useImageSelection(visibleIds);

  // Group (by color flag) when requested.
  const groups = useMemo(() => {
    if (arrange.groupKey !== "flag") return null;
    return FLAG_GROUP_ORDER
      .map((value) => ({
        key: value,
        images: filteredSorted.filter((img) => flagOf(img) === value),
      }))
      .filter((g) => g.images.length > 0);
  }, [filteredSorted, arrange.groupKey, flagOf]);

  // One lightbox sequence across the whole (filtered) gallery, in display order — so paging
  // in the lightbox spans every image even when the grid is split into flag groups.
  const lightboxImages = useMemo(() => {
    const order = groups ? groups.flatMap((g) => g.images) : filteredSorted;
    return order.filter((img) => img.processing_status === "done");
  }, [groups, filteredSorted]);

  const { isOpen } = useLightboxStore();

  function handleVote(imageId: string, flag: string) {
    if (!reviewerName) return;
    api.public.setVote(shareToken, imageId, reviewerName, flag, galleryToken).then(() => {
      qc.invalidateQueries({ queryKey: ["public-votes", shareToken, reviewerName] });
    });
  }

  const hasNav = gallery.subgalleries.length > 0 || !!gallery.parent_share_token;
  // A "container" gallery has sub-galleries but no photos of its own — show its children as cover
  // cards (a landing page). Galleries with their own photos surface children via the breadcrumb.
  const isContainer = gallery.image_count === 0 && gallery.subgalleries.length > 0;
  const canDownload = gallery.downloads_enabled && (gallery.image_count > 0 || gallery.subgalleries.length > 0);
  const filterActive =
    arrange.filterName.trim() !== "" || arrange.flagFilters.size > 0 || arrange.commentsOnly;
  function handleDownload() {
    // Active filter → download exactly the visible photos. Otherwise offer the sub-gallery
    // picker (or download everything directly when there are no sub-galleries).
    if (filterActive) zip.startImages(lightboxImages.map((i) => i.id));
    else if (gallery.subgalleries.length > 0) setDownloadOpen(true);
    else zip.start([]);
  }
  // Show the sidebar (review experience) based on the gallery's own mode. A sub-gallery inherits
  // its parent's mode on creation, but an explicit Showcase override must win — so we follow this
  // gallery's mode, not the parent's, otherwise a Showcase sub-gallery of a Review parent would be
  // stuck in the review layout.
  const showSidebar = collabMode;

  return {
    // inputs
    gallery,
    shareToken,
    galleryToken,
    // refs
    photosRef,
    // mode flags
    collabMode,
    teamVoting,
    watermarkEnabled,
    reviewerName,
    bright,
    openerFont,
    features,
    presentation,
    collectionsEnabled,
    // UI state
    showPrompt,
    setShowPrompt,
    downloadOpen,
    setDownloadOpen,
    toolsOpen,
    setToolsOpen,
    arrange,
    setArrange,
    activeCollection,
    setActiveCollection,
    saveCollectionName,
    setSaveCollectionName,
    pendingCollectionIds,
    setPendingCollectionIds,
    // data
    rawImages,
    isLoading,
    collections,
    zip,
    // derived
    votesByImageId,
    likedSet,
    filteredSorted,
    visibleIds,
    selection,
    groups,
    lightboxImages,
    isOpen,
    hasNav,
    isContainer,
    canDownload,
    filterActive,
    showSidebar,
    // mutations + handlers
    createCollectionMutation,
    deleteCollectionMutation,
    renameCollectionMutation,
    handleVote,
    toggleLike,
    handleDownload,
  };
}

export type GalleryViewModel = ReturnType<typeof useGalleryView>;
