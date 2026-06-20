// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColorFlag, CollabFeatures, GridPresentation, ImageResponse, LayoutType } from "@/lib/types";
import { useLightboxStore, type LightboxIntent } from "@/store/lightbox";
import { api } from "@/lib/api";
import { GRID_COLS, GAP, GAP_PX, JUSTIFIED_ROW_HEIGHT, cornerRounding, gridSizes, imageAspect, previewSrcSet } from "@/lib/gridLayout";
import { JustifiedGrid } from "@/components/JustifiedGrid";
import { Loader2, AlertCircle, Check } from "lucide-react";
import { Icons } from "@/lib/ui-icons";
import { OverlayPill } from "@/components/chrome/OverlayPill";
import { MediaBadge } from "@/components/chrome/MediaBadge";
import { useTranslations } from "next-intl";

const FLAG_COLORS: { value: ColorFlag; bg: string }[] = [
  { value: "green",  bg: "bg-green-500" },
  { value: "red",    bg: "bg-red-500" },
  { value: "yellow", bg: "bg-yellow-400" },
  { value: "blue",   bg: "bg-blue-400" },
];

const DEFAULT_FEATURES: CollabFeatures = { colorFlags: true, likes: false, comments: true, annotations: false };
const DEFAULT_PRESENTATION: GridPresentation = {
  previewSize: "medium",
  previewSpacing: "medium",
  previewCorners: "round",
  showFilename: false,
  bright: false,
  highRes: true,
};

interface Props {
  images: ImageResponse[];
  layout: LayoutType;
  collabMode?: boolean;
  shareToken?: string;
  galleryToken?: string;
  teamVoting?: boolean;
  reviewerVotes?: Record<string, string>;
  onVote?: (imageId: string, flag: string) => void;
  /** Image ids the current reviewer has liked (filled-when-mine heart). */
  likedSet?: Set<string>;
  onToggleLike?: (imageId: string) => void;
  features?: CollabFeatures;
  presentation?: GridPresentation;
  // Collections selection mode.
  selectionMode?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string) => void;
  onRangeSelect?: (id: string) => void;
  /** Full ordered set the lightbox should traverse (done-only). Defaults to this grid's
   *  own images — pass the gallery-wide list so grouped sections share one lightbox sequence. */
  lightboxImages?: ImageResponse[];
}

export function PhotoGrid({
  images,
  layout,
  collabMode = false,
  shareToken,
  galleryToken,
  teamVoting = false,
  reviewerVotes = {},
  onVote,
  likedSet,
  onToggleLike,
  features = DEFAULT_FEATURES,
  presentation = DEFAULT_PRESENTATION,
  selectionMode = false,
  isSelected,
  onToggleSelect,
  onRangeSelect,
  lightboxImages,
}: Props) {
  const { open } = useLightboxStore();
  const ready = images.filter((img) => img.processing_status === "done");
  const pending = images.filter((img) => img.processing_status === "pending");
  const failed = images.filter((img) => img.processing_status === "error");

  // The lightbox traverses the gallery-wide list when given, else just this grid.
  const lightboxList = lightboxImages ?? ready;

  const rounded = cornerRounding(presentation.previewCorners);

  function tile(img: ImageResponse, i: number, aspectSquare: boolean, fixedHeight?: number) {
    return (
      <PhotoTile
        key={img.id}
        img={img}
        onOpen={(intent) => open(lightboxList, lightboxImages ? lightboxList.findIndex((x) => x.id === img.id) : i, intent)}
        selectionMode={selectionMode}
        selected={isSelected?.(img.id) ?? false}
        onSelect={(shift) => (shift ? onRangeSelect : onToggleSelect)?.(img.id)}
        aspectSquare={aspectSquare}
        fixedHeight={fixedHeight}
        highRes={presentation.highRes}
        sizes={fixedHeight ? `${Math.round(fixedHeight * imageAspect(img))}px` : gridSizes(layout, presentation.previewSize)}
        collabMode={collabMode}
        shareToken={shareToken}
        galleryToken={galleryToken}
        teamVoting={teamVoting}
        reviewerFlag={reviewerVotes[img.id] as ColorFlag | undefined}
        onVote={onVote}
        liked={likedSet?.has(img.id) ?? false}
        onToggleLike={onToggleLike}
        features={features}
        rounded={rounded}
        showFilename={presentation.showFilename}
        bright={presentation.bright}
      />
    );
  }

  if (layout === "masonry") {
    return (
      <div>
        <JustifiedGrid
          items={ready}
          itemKey={(img) => img.id}
          aspect={imageAspect}
          targetRowHeight={JUSTIFIED_ROW_HEIGHT[presentation.previewSize]}
          gap={GAP_PX[presentation.previewSpacing]}
          renderItem={(img, i, height) => tile(img, i, false, height)}
        />
        <PendingStrip pending={pending} failed={failed} />
      </div>
    );
  }

  const colClass = layout === "list" ? "grid-cols-1 sm:grid-cols-2" : GRID_COLS[presentation.previewSize];

  return (
    <div>
      <div className={`grid ${colClass} ${GAP[presentation.previewSpacing]}`}>
        {ready.map((img, i) => tile(img, i, layout !== "list"))}
      </div>
      <PendingStrip pending={pending} failed={failed} />
    </div>
  );
}

function PhotoTile({
  img,
  onOpen,
  selectionMode = false,
  selected = false,
  onSelect,
  aspectSquare = false,
  fixedHeight,
  highRes = true,
  sizes,
  collabMode = false,
  shareToken,
  galleryToken,
  teamVoting = false,
  reviewerFlag,
  onVote,
  liked = false,
  onToggleLike,
  features,
  rounded,
  showFilename,
  bright,
}: {
  img: ImageResponse;
  onOpen: (intent?: LightboxIntent) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (shift: boolean) => void;
  aspectSquare?: boolean;
  /** Exact tile height in px (justified rows); the image fills and covers the box. */
  fixedHeight?: number;
  /** Instance-wide setting; when off, tiles stick to the thumb rendition (no srcset). */
  highRes?: boolean;
  /** `sizes` attribute matching the tile's rendered width, for srcset selection. */
  sizes?: string;
  collabMode?: boolean;
  shareToken?: string;
  galleryToken?: string;
  teamVoting?: boolean;
  reviewerFlag?: ColorFlag;
  onVote?: (imageId: string, flag: string) => void;
  liked?: boolean;
  onToggleLike?: (imageId: string) => void;
  features: CollabFeatures;
  rounded: string;
  showFilename: boolean;
  bright: boolean;
}) {
  const t = useTranslations("gallery.grid");
  const tf = useTranslations("gallery.flags");
  const qc = useQueryClient();
  const [localFlag, setLocalFlag] = useState<ColorFlag>(img.color_flag);

  const effectiveFlag: ColorFlag = teamVoting ? (reviewerFlag ?? "none") : localFlag;
  // In team voting, likes/comments are hidden in favour of per-reviewer flags.
  const showFlags = features.colorFlags;
  const showLikes = features.likes && !teamVoting;
  const showComments = features.comments;
  const showAnnotate = features.annotations;
  const plainComments = img.comment_count - img.annotation_count;
  const showToolbar = collabMode && !!shareToken && (showFlags || showLikes || showComments || showAnnotate);

  const flagMutation = useMutation({
    mutationFn: (flag: ColorFlag) => {
      if (!shareToken) throw new Error("no token");
      return api.public.flagImage(shareToken, img.id, flag, galleryToken);
    },
    onMutate: (flag) => setLocalFlag(flag),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public-images"] }),
    onError: () => setLocalFlag(img.color_flag),
  });

  function handleFlag(flagValue: ColorFlag) {
    if (teamVoting && onVote) {
      const next = effectiveFlag === flagValue ? "none" : flagValue;
      onVote(img.id, next);
    } else {
      flagMutation.mutate(effectiveFlag === flagValue ? "none" : flagValue);
    }
  }

  const activeFlagColor = FLAG_COLORS.find((f) => f.value === effectiveFlag);
  const downloadUrl = img.original_url;
  // `original_url` is only present when the gallery has downloads enabled (backend-gated),
  // so a per-photo download button shows on hover in any mode — collaboration or presentation.
  const showDownload = !!downloadUrl && !selectionMode;

  return (
    <div>
      <div
        className={`group relative overflow-hidden ${rounded} bg-zinc-900 ${aspectSquare ? "aspect-square" : ""}`}
        style={fixedHeight ? { height: fixedHeight } : undefined}
      >
        {/* Clickable image → lightbox, or toggle selection in selection mode */}
        <button
          onClick={(e) => (selectionMode ? onSelect?.(e.shiftKey) : onOpen())}
          aria-label={img.original_filename}
          className={`block w-full h-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${selectionMode || collabMode ? "cursor-pointer" : "cursor-zoom-in"}`}
        >
          {img.is_video ? (
            // Browser-rendered poster: preload metadata and seek to the first frame.
            <video
              src={img.video_url ? `${img.video_url}#t=0.1` : undefined}
              preload="metadata"
              muted
              playsInline
              onContextMenu={(e) => e.preventDefault()}
              className={`w-full ${aspectSquare || fixedHeight ? "h-full object-cover" : "h-auto"}`}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={img.thumb_url!}
              srcSet={highRes ? previewSrcSet(img, true) : undefined}
              sizes={highRes ? sizes : undefined}
              alt={img.original_filename}
              loading="lazy"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              style={!aspectSquare && !fixedHeight ? { aspectRatio: imageAspect(img) } : undefined}
              className={`w-full select-none [-webkit-touch-callout:none] ${aspectSquare || fixedHeight ? "h-full object-cover" : "h-auto"}`}
            />
          )}
        </button>

        {/* Play badge marks video tiles */}
        {img.is_video && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <OverlayPill variant="control" shape="circle" className="w-11 h-11">
              <Icons.play size={20} className="translate-x-0.5 fill-current" />
            </OverlayPill>
          </div>
        )}

        {/* Selection overlay */}
        {selectionMode && (
          <div className={`absolute inset-0 pointer-events-none transition-colors ${selected ? "ring-2 ring-inset ring-white bg-black/30" : ""}`}>
            <div className={`absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center ${selected ? "bg-white text-black" : "bg-black/40 text-white border border-white/70"}`}>
              {selected && <Check size={12} />}
            </div>
          </div>
        )}

        {/* Persistent active-flag dot (hidden while hovering, where the picker takes over).
            White ring + soft dark shadow so it reads on both bright and dark photos. */}
        {collabMode && showFlags && effectiveFlag !== "none" && (
          <div className={`absolute top-2 right-2 w-3.5 h-3.5 rounded-full ring-2 ring-white shadow-[0_0_3px_rgba(0,0,0,0.6)] ${activeFlagColor?.bg ?? ""} sm:group-hover:opacity-0 transition-opacity pointer-events-none`} />
        )}

        {/* Persistent comment/annotation indicator so flagged photos are spottable without opening.
            On touch it's the only comment cue (the hover overlay is desktop-only); on desktop it
            rests visible and hides on hover where those buttons take over. */}
        {showToolbar && (showComments || showAnnotate) && (
          <MediaBadge
            img={img}
            className="absolute bottom-2 right-2 flex pointer-events-none sm:group-hover:opacity-0 transition-opacity"
          />
        )}

        {/* Hover overlay with corner controls — desktop only (hover-reveal). On touch there is no
            hover, so per-photo controls would otherwise sit permanently over every image; instead
            the resting indicators above stay and all flagging/commenting happens in the lightbox.
            Shown for the collab toolbar OR a standalone download button (presentation mode). */}
        {(showToolbar || showDownload) && !selectionMode && (
          <div className="absolute inset-0 pointer-events-none hidden sm:block opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />

            {/* Top-right: flag picker */}
            {showToolbar && showFlags && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5 sm:gap-1 pointer-events-auto">
                {FLAG_COLORS.map((f) => (
                  <button
                    key={f.value}
                    onClick={(e) => { e.stopPropagation(); handleFlag(f.value); }}
                    disabled={!teamVoting && flagMutation.isPending}
                    title={tf(f.value)}
                    aria-label={tf(f.value)}
                    aria-pressed={effectiveFlag === f.value}
                    className={`w-7 h-7 sm:w-5 sm:h-5 rounded-full transition-all outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-black/40 ${f.bg} ${
                      effectiveFlag === f.value
                        ? "opacity-100 ring-2 ring-white/70 scale-110"
                        : "opacity-60 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Bottom-left: download + like */}
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 pointer-events-auto">
              {showDownload && (
                <OverlayPill
                  as="a"
                  variant="control"
                  size="sm"
                  shape="pill"
                  href={downloadUrl}
                  download={img.original_filename}
                  onClick={(e) => e.stopPropagation()}
                  title={t("downloadOriginal")}
                >
                  <Icons.download size={13} /> {t("download")}
                </OverlayPill>
              )}
              {showToolbar && showLikes && (
                <OverlayPill
                  as="button"
                  variant="control"
                  size="sm"
                  shape="pill"
                  onClick={(e) => { e.stopPropagation(); onToggleLike?.(img.id); }}
                  title={t("like")}
                >
                  <Icons.like size={13} className={liked ? "fill-red-500 text-red-500" : ""} />
                  {img.likes > 0 && <span className="text-[11px]">{img.likes}</span>}
                </OverlayPill>
              )}
            </div>

            {/* Bottom-right: annotations + comments (each opens the lightbox to its panel) */}
            {showToolbar && (showAnnotate || showComments) && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 pointer-events-auto">
                {showAnnotate && (
                  <OverlayPill
                    as="button"
                    variant="control"
                    size="sm"
                    shape="pill"
                    onClick={(e) => { e.stopPropagation(); onOpen({ panel: "annotations" }); }}
                    title={t("annotate")}
                  >
                    <Icons.annotation size={13} />
                    {img.annotation_count > 0 && <span className="text-[11px]">{img.annotation_count}</span>}
                  </OverlayPill>
                )}
                {showComments && (
                  <OverlayPill
                    as="button"
                    variant="control"
                    size="sm"
                    shape="pill"
                    onClick={(e) => { e.stopPropagation(); onOpen({ panel: "comments" }); }}
                    title={t("comments")}
                  >
                    <Icons.comment size={13} />
                    {plainComments > 0 && <span className="text-[11px]">{plainComments}</span>}
                  </OverlayPill>
                )}
              </div>
            )}
          </div>
        )}

        {/* Count badges when comments/annotations are on but there's no collab toolbar */}
        {!showToolbar && (
          <MediaBadge img={img} className="absolute bottom-2 right-2 pointer-events-none" />
        )}
      </div>

      {/* Filename caption */}
      {showFilename && (
        <p className={`text-[11px] truncate pt-0.5 px-0.5 ${bright ? "text-zinc-600" : "text-zinc-400"}`}>
          {img.original_filename}
        </p>
      )}
    </div>
  );
}

function PendingStrip({
  pending,
  failed,
}: {
  pending: ImageResponse[];
  failed: ImageResponse[];
}) {
  const t = useTranslations("gallery.grid");
  if (!pending.length && !failed.length) return null;
  return (
    <div className="flex gap-2 flex-wrap mt-4">
      {pending.map((img) => (
        <div
          key={img.id}
          className="w-16 h-16 rounded bg-zinc-800 flex items-center justify-center"
          title={img.original_filename}
        >
          <Loader2 size={16} className="text-zinc-500 animate-spin" />
        </div>
      ))}
      {failed.map((img) => (
        <div
          key={img.id}
          className="w-16 h-16 rounded bg-zinc-800 flex items-center justify-center"
          title={t("failed", { filename: img.original_filename })}
        >
          <AlertCircle size={16} className="text-red-500" />
        </div>
      ))}
    </div>
  );
}
