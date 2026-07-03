// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { ColorFlag, ImageResponse, Rating } from "@/lib/types";
import { showsFlags, showsStars } from "@/lib/types";
import { previewSrcSet } from "@/lib/gridLayout";
import { cn } from "@/lib/utils";
import { AlertCircle, Loader2, Trash2, Ban, MoreVertical, Frame, Image as ImageIcon, FolderInput, UploadCloud, Check, Clock, Layers } from "lucide-react";
import { Icons } from "@/lib/ui-icons";
import { OverlayPill, overlayPillVariants } from "@/components/chrome/OverlayPill";
import { MediaBadge } from "@/components/chrome/MediaBadge";
import { StarRating } from "@/components/chrome/StarRating";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { CardProps } from "./admin-grid-types";

const FLAG_COLORS: { value: ColorFlag; bg: string; label: string }[] = [
  { value: "green",  bg: "bg-green-500",  label: "Green" },
  { value: "red",    bg: "bg-red-500",    label: "Red" },
  { value: "yellow", bg: "bg-yellow-400", label: "Yellow" },
  { value: "blue",   bg: "bg-blue-400",   label: "Blue" },
];

const FLAG_BG: Record<ColorFlag, string> = {
  none:   "",
  green:  "bg-green-500",
  red:    "bg-red-500",
  yellow: "bg-yellow-400",
  blue:   "bg-blue-400",
};

export function AdminTile({
  img, galleryId, onDelete, deleting, onOpen, rounded, highRes, ratingMode, aspectSquare, fixedHeight, sizes, dragProps,
  onSetHeaderImage, onSetCoverImage, onRenameImage, onMoveImage, onRemoveFromCollection,
  selectionMode, isSelected, onToggleSelect, onRangeSelect,
}: { img: ImageResponse; aspectSquare: boolean; fixedHeight?: number; sizes?: string; dragProps?: Record<string, unknown> } & CardProps) {
  const t = useTranslations("admin.imageGrid");
  const tflag = useTranslations("gallery.flags");
  const qc = useQueryClient();
  const starsUI = showsStars(ratingMode);
  const flagUI = showsFlags(ratingMode);
  const [localFlag, setLocalFlag] = useState<ColorFlag>(img.color_flag);
  // Adopt the stored flag when it changes from outside this tile (e.g. set in the lightbox) —
  // render-time sync, keyed on the value. An in-flight optimistic change is safe: img.color_flag
  // only moves once the refetch lands, by which point it equals localFlag.
  const [syncedFlag, setSyncedFlag] = useState<ColorFlag>(img.color_flag);
  if (img.color_flag !== syncedFlag) {
    setSyncedFlag(img.color_flag);
    setLocalFlag(img.color_flag);
  }
  const draggable = !!dragProps;
  const selected = !!isSelected?.(img.id);

  const flagMutation = useMutation({
    mutationFn: (flag: ColorFlag) => api.images.update(img.id, { color_flag: flag }),
    onMutate: (flag) => setLocalFlag(flag),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gallery-images", galleryId] }),
    onError: () => setLocalFlag(img.color_flag),
  });

  function setFlag(flag: ColorFlag) {
    flagMutation.mutate(localFlag === flag ? "none" : flag);
  }

  // Star rating mirrors the flag state (optimistic local + render-time external sync).
  const [localRating, setLocalRating] = useState<number>(img.rating);
  const [syncedRating, setSyncedRating] = useState<number>(img.rating);
  if (img.rating !== syncedRating) {
    setSyncedRating(img.rating);
    setLocalRating(img.rating);
  }
  const ratingMutation = useMutation({
    mutationFn: (rating: number) => api.images.update(img.id, { rating: rating as Rating }),
    onMutate: (rating) => setLocalRating(rating),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gallery-images", galleryId] }),
    onError: () => setLocalRating(img.rating),
  });

  const pending = img.moderation_status === "pending";
  const approveMutation = useMutation({
    mutationFn: () => api.images.approve(galleryId, img.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gallery-images", galleryId] }),
  });

  const media = (
    <>
      {img.processing_status === "pending" && (
        <div className="w-full h-full flex items-center justify-center aspect-square">
          <Loader2 size={20} className="text-muted-foreground animate-spin" />
        </div>
      )}
      {img.processing_status === "error" && (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 aspect-square">
          <AlertCircle size={20} className="text-destructive" />
          <span className="text-xs text-destructive">{t("failed")}</span>
        </div>
      )}
      {img.is_video && (
        <>
          {/* Browser-rendered poster: preload metadata, seek to first frame */}
          <video
            src={img.video_url ? `${img.video_url}#t=0.1` : undefined}
            preload="metadata"
            muted
            playsInline
            className={`w-full ${aspectSquare || fixedHeight ? "h-full object-cover" : "h-auto"}`}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <OverlayPill variant="control" shape="circle" className="w-10 h-10">
              <Icons.play size={18} className="translate-x-0.5 fill-current" />
            </OverlayPill>
          </div>
        </>
      )}
      {!img.is_video && img.processing_status === "done" && img.thumb_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.thumb_url}
          srcSet={highRes ? previewSrcSet(img, true) : undefined}
          sizes={highRes ? sizes : undefined}
          alt={img.original_filename}
          loading="lazy"
          className={`w-full ${aspectSquare || fixedHeight ? "h-full object-cover" : "h-auto"}`}
        />
      )}
      {img.processing_status === "no_preview" && (
        // Stored but unviewable (e.g. PSB without an embedded thumbnail) — download-only.
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 aspect-square text-muted-foreground px-2 text-center">
          <Icons.noPreviewFile size={22} />
          <span className="text-xs uppercase tracking-wide truncate max-w-full">
            {img.original_filename.includes(".")
              ? img.original_filename.slice(img.original_filename.lastIndexOf(".") + 1).toUpperCase()
              : "FILE"}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div
        className={`group relative overflow-hidden ${rounded} bg-muted ${aspectSquare ? "aspect-square" : ""}`}
        style={fixedHeight ? { height: fixedHeight } : undefined}
      >
        {selectionMode ? (
          // Selectable AND draggable: a tap (no movement) toggles selection; a drag past the
          // sensor's threshold picks the photo(s) up to move into another gallery.
          <div
            {...(draggable ? dragProps : {})}
            onClick={(e) => (e.shiftKey ? onRangeSelect : onToggleSelect)?.(img.id)}
            className={cn("block w-full h-full", draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
          >
            {media}
          </div>
        ) : draggable ? (
          <div {...dragProps} onClick={() => onOpen?.(img)} className="block w-full h-full cursor-grab active:cursor-grabbing">{media}</div>
        ) : (
          <button onClick={() => onOpen?.(img)} className="block w-full h-full cursor-zoom-in">{media}</button>
        )}

        {/* Selection overlay */}
        {selectionMode && (
          <div className={cn("absolute inset-0 pointer-events-none transition-colors", selected && "ring-2 ring-primary ring-inset bg-primary/10")}>
            <div className={cn(
              "absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center",
              selected ? "bg-primary text-primary-foreground" : "bg-black/40 text-white border border-white/70",
            )}>
              {selected && <Check size={12} />}
            </div>
          </div>
        )}

        {/* Persistent rating badge: flag dot and/or star row in one line ("both" mode puts the dot
            left of the stars) — white ring + soft dark shadow so it reads on both bright and dark photos */}
        {((flagUI && localFlag !== "none") || (starsUI && localRating > 0)) && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 pointer-events-none group-hover:opacity-0 transition-opacity">
            {flagUI && localFlag !== "none" && (
              <div className={cn("w-3.5 h-3.5 rounded-full ring-2 ring-white shadow-[0_0_3px_rgba(0,0,0,0.6)]", FLAG_BG[localFlag])} />
            )}
            {starsUI && localRating > 0 && (
              <StarRating
                value={localRating}
                size={13}
                starClassName="text-amber-400 drop-shadow-[0_0_2px_rgba(0,0,0,0.7)]"
                emptyClassName="text-white/40 drop-shadow-[0_0_2px_rgba(0,0,0,0.7)]"
              />
            )}
          </div>
        )}

        {/* Comment + annotation badges (bottom-right; the kebab takes over this slot on hover) */}
        <MediaBadge
          img={img}
          className="absolute bottom-2 right-2 pointer-events-none group-hover:opacity-0 transition-opacity"
        />

        {/* Pending-moderation badge — persistent so unapproved uploads stand out at a glance */}
        {pending && !selectionMode && (
          <OverlayPill
            variant="badge"
            size="xs"
            className="absolute top-2 left-2 pointer-events-none bg-amber-500/90 text-white"
          >
            <Clock size={10} className="shrink-0" /> {t("pending")}
          </OverlayPill>
        )}

        {/* Client-upload badge — shows who contributed the photo */}
        {img.uploaded_by && (
          <OverlayPill
            variant="badge"
            size="xs"
            className="absolute bottom-2 left-2 max-w-[80%] pointer-events-none group-hover:opacity-0 transition-opacity"
          >
            <UploadCloud size={10} className="shrink-0" />
            <span className="truncate">{img.uploaded_by}</span>
          </OverlayPill>
        )}

        {/* Hover overlay */}
        {img.processing_status === "done" && !selectionMode && (
          <div
            className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />

            {/* Center: approve / reject a pending client upload */}
            {pending && (
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center gap-2 pointer-events-auto">
                <OverlayPill
                  as="button"
                  variant="control"
                  size="sm"
                  shape="pill"
                  disabled={approveMutation.isPending}
                  onClick={(e) => { e.stopPropagation(); approveMutation.mutate(); }}
                  title={t("approve")}
                >
                  <Check size={13} className="text-emerald-400" /> {t("approve")}
                </OverlayPill>
                <OverlayPill
                  as="button"
                  variant="control"
                  size="sm"
                  shape="pill"
                  disabled={deleting}
                  onClick={(e) => { e.stopPropagation(); onDelete(img); }}
                  title={t("reject")}
                >
                  <Ban size={13} className="text-red-400" /> {t("reject")}
                </OverlayPill>
              </div>
            )}

            {/* Top-right: rating pickers — star picker above the flag row ("both" mode stacks them). */}
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
              {starsUI && (
                <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                  <StarRating
                    value={localRating}
                    onChange={(v) => ratingMutation.mutate(v)}
                    size={18}
                    starClassName="text-amber-400 drop-shadow-[0_0_2px_rgba(0,0,0,0.7)]"
                    emptyClassName="text-white/50 drop-shadow-[0_0_2px_rgba(0,0,0,0.7)]"
                  />
                </div>
              )}

              {/* Flag picker. The clear button leads the row so the color dots stay anchored at
                  the right edge — clicking a flag won't shift the dot you just set. */}
              {flagUI && (
                <div className="flex items-center gap-1 pointer-events-auto">
                  {localFlag !== "none" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); flagMutation.mutate("none"); }}
                      title={t("clearFlag")}
                      className="w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75"
                    >
                      <Ban size={11} />
                    </button>
                  )}
                  {FLAG_COLORS.map((f) => (
                    <button
                      key={f.value}
                      onClick={(e) => { e.stopPropagation(); setFlag(f.value); }}
                      disabled={flagMutation.isPending}
                      title={tflag(f.value)}
                      className={`w-5 h-5 rounded-full transition-all ${f.bg} ${
                        localFlag === f.value ? "opacity-100 ring-2 ring-white/70 scale-110" : "opacity-60 hover:opacity-100"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Bottom-left: download */}
            {img.original_url && (
              <OverlayPill
                as="a"
                variant="control"
                size="sm"
                shape="pill"
                href={img.original_url}
                download={img.original_filename}
                onClick={(e) => e.stopPropagation()}
                title={t("downloadOriginal")}
                className="absolute bottom-2 left-2 pointer-events-auto"
              >
                <Icons.download size={13} /> {t("download")}
              </OverlayPill>
            )}

            {/* Bottom-right: annotations + comments (open the lightbox to their panel) + kebab */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 pointer-events-auto">
              <OverlayPill
                as="button"
                variant="control"
                size="sm"
                shape="pill"
                onClick={(e) => { e.stopPropagation(); onOpen?.(img, { panel: "annotations" }); }}
                title={t("annotate")}
              >
                <Icons.annotation size={13} />
                {img.annotation_count > 0 && <span className="text-[11px]">{img.annotation_count}</span>}
              </OverlayPill>
              <OverlayPill
                as="button"
                variant="control"
                size="sm"
                shape="pill"
                onClick={(e) => { e.stopPropagation(); onOpen?.(img, { panel: "comments" }); }}
                title={t("comments")}
              >
                <Icons.comment size={13} />
                {img.comment_count - img.annotation_count > 0 && (
                  <span className="text-[11px]">{img.comment_count - img.annotation_count}</span>
                )}
              </OverlayPill>
              {/* Kebab → actions. Base UI portals + positions the menu, escaping overflow:hidden. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={overlayPillVariants({ variant: "control", size: "sm", shape: "iconPill" })}
                  title={t("moreActions")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={13} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onSetHeaderImage && (
                    <DropdownMenuItem onClick={() => onSetHeaderImage(img)}>
                      <Frame size={13} /> {t("setHeader")}
                    </DropdownMenuItem>
                  )}
                  {onSetCoverImage && (
                    <DropdownMenuItem onClick={() => onSetCoverImage(img)}>
                      <ImageIcon size={13} /> {t("setCover")}
                    </DropdownMenuItem>
                  )}
                  {(onSetHeaderImage || onSetCoverImage) && <DropdownMenuSeparator />}
                  {onRenameImage && (
                    <DropdownMenuItem onClick={() => onRenameImage(img)}>
                      <Icons.rename size={13} /> {t("renameFile")}
                    </DropdownMenuItem>
                  )}
                  {onMoveImage && (
                    <DropdownMenuItem onClick={() => onMoveImage(img)}>
                      <FolderInput size={13} /> {t("moveToGallery")}
                    </DropdownMenuItem>
                  )}
                  {onRemoveFromCollection && (
                    <DropdownMenuItem onClick={() => onRemoveFromCollection(img)}>
                      <Layers size={13} /> {t("removeFromCollection")}
                    </DropdownMenuItem>
                  )}
                  {(onRenameImage || onMoveImage || onRemoveFromCollection) && <DropdownMenuSeparator />}
                  <DropdownMenuItem destructive disabled={deleting} onClick={() => onDelete(img)}>
                    <Trash2 size={13} /> {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>

      {/* Filename caption */}
      <p className="text-[11px] text-muted-foreground truncate mt-1 px-0.5" title={img.original_filename}>
        {img.original_filename}
      </p>
    </div>
  );
}
