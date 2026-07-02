// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ClientUploadButton } from "./ClientUploadButton";
import { StudioMasthead } from "./StudioMasthead";
import { Loader2, Download } from "lucide-react";
import type { GalleryViewModel } from "./useGalleryView";

const OPENER_SIZE: Record<string, string> = {
  small: "text-2xl",
  medium: "text-3xl",
  large: "text-5xl",
};

// Full-screen hero gets a larger, responsive scale than the inline header — driven by the
// same per-gallery "Heading size" (opener_font_size) setting.
const HERO_TITLE_SIZE: Record<string, string> = {
  small: "text-4xl sm:text-5xl",
  medium: "text-5xl sm:text-6xl",
  large: "text-6xl sm:text-7xl",
};

const HERO_SUBTITLE_SIZE: Record<string, string> = {
  small: "text-base sm:text-lg",
  medium: "text-lg sm:text-xl",
  large: "text-xl sm:text-2xl",
};

// Title anchor over the hero → flex placement + text alignment. Full class strings so
// Tailwind's scanner keeps them. "center" reproduces the legacy centered layout.
const HERO_TITLE_POSITION: Record<string, string> = {
  "top-left": "justify-start items-start text-left",
  "top-center": "justify-start items-center text-center",
  "top-right": "justify-start items-end text-right",
  "center-left": "justify-center items-start text-left",
  center: "justify-center items-center text-center",
  "center-right": "justify-center items-end text-right",
  "bottom-left": "justify-end items-start text-left",
  "bottom-center": "justify-end items-center text-center",
  "bottom-right": "justify-end items-end text-right",
};

/**
 * Full-width layout for presentation galleries: a full-screen hero when a header image is set,
 * otherwise a standard header. Shared content (breadcrumb, sub-gallery cards, photo grid, footer)
 * is passed in as slots.
 */
export function GalleryPresentationLayout({
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
    bright,
    openerFont,
    canDownload,
    zip,
    handleDownload,
  } = vm;

  // Title/subtitle legibility: a stronger drop-shadow when opted in (e.g. a bright header
  // shown without the scrim), otherwise the subtle default.
  const titleShadow = gallery.opener_title_shadow
    ? "drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
    : "drop-shadow-md";

  return (
    /* Full-width layout for presentation galleries */
    <>
      {/* Mobile-only "go up to parent" bar — owns the sticky top here (no other sticky bar in
          presentation mode); null for top-level galleries */}
      {upNav}
      {gallery.header_image_url ? (
        /* Full-screen hero when header image is set */
        <>
          <div className="relative w-full h-screen overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gallery.header_image_url}
              alt=""
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              className="absolute inset-0 w-full h-full object-cover select-none [-webkit-touch-callout:none]"
              style={{ objectPosition: `${gallery.header_focus_x ?? 50}% ${gallery.header_focus_y ?? 50}%` }}
            />
            {/* Scrim overlay for legibility of the centered title (per-gallery toggle) */}
            {gallery.opener_scrim && (
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/25 to-black/55" />
            )}

            {/* Studio identity pinned top-left over the hero */}
            {gallery.instance_name && (
              <StudioMasthead
                name={gallery.instance_name}
                logoUrl={gallery.logo_url}
                className="absolute top-5 left-6 z-10"
                textClassName="text-white drop-shadow-md"
              />
            )}

            {/* Title + subtitle anchored over the hero (per-gallery position; py clears the
                top-left masthead and bottom scroll indicator) */}
            <div
              className={`absolute inset-0 flex flex-col px-8 py-20 ${
                HERO_TITLE_POSITION[gallery.opener_title_position] ?? HERO_TITLE_POSITION.center
              }`}
            >
              <h1
                className={`${titleShadow} line-clamp-2 ${HERO_TITLE_SIZE[gallery.opener_font_size] ?? HERO_TITLE_SIZE.medium} text-white`}
                style={openerFont}
              >
                {gallery.name}
              </h1>
              {gallery.headline && (
                <p className={`mt-3 max-w-2xl text-white/85 ${titleShadow} ${HERO_SUBTITLE_SIZE[gallery.opener_font_size] ?? HERO_SUBTITLE_SIZE.medium}`}>{gallery.headline}</p>
              )}
              <p className="mt-3 text-xs text-white/60">{t("photoCount", { count: gallery.image_count })}</p>
            </div>

            {/* Scroll-down indicator pinned to the bottom */}
            <button
              onClick={() => photosRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="group absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 rounded-full px-3 py-1.5 text-white/50 transition-all hover:bg-white/15 hover:text-white"
              aria-label={t("view.scrollToPhotos")}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className="animate-bounce">
                <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">{t("view.scrollToPhotos")}</span>
            </button>
          </div>

          {/* Download button — centred between hero and photo grid, equal gap on both sides */}
          {canDownload && (
            <div className={`flex justify-center py-6 ${bright ? "bg-zinc-50" : "bg-zinc-950"}`}>
              <button
                onClick={handleDownload}
                disabled={zip.preparing}
                className={`inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                  bright ? "bg-zinc-900 text-white hover:bg-zinc-700" : "bg-zinc-100 text-zinc-900 hover:bg-white"
                }`}
              >
                {zip.preparing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {zip.preparing ? t("view.preparing") : t("view.downloadAll")}
              </button>
            </div>
          )}

          {gallery.client_upload_enabled && (
            <div className={`flex justify-center pb-6 ${canDownload ? "" : "pt-6"} ${bright ? "bg-zinc-50" : "bg-zinc-950"}`}>
              <ClientUploadButton
                shareToken={shareToken}
                galleryToken={galleryToken}
                moderation={gallery.client_upload_moderation}
                className={`inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium border transition-colors disabled:opacity-60 ${
                  bright ? "border-zinc-300 text-zinc-800 hover:bg-zinc-100" : "border-zinc-700 text-zinc-100 hover:bg-zinc-800"
                }`}
              />
            </div>
          )}

          <main ref={photosRef} className="px-4 pb-4 space-y-5">
            {breadcrumb}
            {subGalleryCards}
            {photoGrid}
            {galleryFooter}
          </main>
        </>
      ) : (
        /* Standard header when no image */
        <>
          <header className={`px-6 py-8 border-b ${bright ? "border-zinc-200" : "border-zinc-900"}`}>
            {gallery.instance_name && (
              <StudioMasthead
                name={gallery.instance_name}
                logoUrl={gallery.logo_url}
                className="mb-4"
                textClassName={bright ? "text-zinc-700" : "text-zinc-300"}
              />
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1
                  className={`${OPENER_SIZE[gallery.opener_font_size] ?? "text-3xl"} ${bright ? "text-zinc-900" : "text-zinc-100"}`}
                  style={openerFont}
                >
                  {gallery.name}
                </h1>
                {gallery.headline && (
                  <p className={`mt-1 text-sm ${bright ? "text-zinc-600" : "text-zinc-400"}`}>{gallery.headline}</p>
                )}
                <p className={`text-xs mt-2 ${bright ? "text-zinc-500" : "text-zinc-600"}`}>{t("photoCount", { count: gallery.image_count })}</p>
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                {gallery.client_upload_enabled && (
                  <ClientUploadButton
                    shareToken={shareToken}
                    galleryToken={galleryToken}
                    moderation={gallery.client_upload_moderation}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border transition-colors disabled:opacity-60 ${
                      bright ? "border-zinc-300 text-zinc-800 hover:bg-zinc-100" : "border-zinc-700 text-zinc-100 hover:bg-zinc-800"
                    }`}
                  />
                )}
                {canDownload && (
                  <button
                    onClick={handleDownload}
                    disabled={zip.preparing}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                      bright
                        ? "bg-zinc-900 text-white hover:bg-zinc-800"
                        : "bg-zinc-100 text-zinc-900 hover:bg-white"
                    }`}
                  >
                    {zip.preparing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {zip.preparing ? t("view.preparing") : t("view.download")}
                  </button>
                )}
              </div>
            </div>
          </header>

          <main className="p-4 space-y-5">
            {breadcrumb}
            {subGalleryCards}
            {photoGrid}
            {galleryFooter}
          </main>
        </>
      )}
    </>
  );
}
