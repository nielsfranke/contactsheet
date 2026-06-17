// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Mobile-only ("md:hidden") sticky "go up" bar for nested galleries: a back chevron + a label,
 * linking one level up. Gives an obvious way out of a sub-folder on a phone, where the parent link
 * is otherwise buried — the breadcrumb (public Showcase) reads as decoration, and the parent links
 * (public Review sidebar / admin sidebar) sit behind the off-canvas drawer.
 *
 * Shared by the public gallery (parent share link) and the admin in-gallery view (parent detail
 * page, or "All Galleries" for a top-level gallery). Pass `href = null` to render nothing.
 *
 * Styled with semantic tokens + the same band treatment as {@link ToolbarBand}, so it resolves
 * against the admin theme on `/admin` and the per-gallery tone inside a `.gallery-scope` on the
 * public page, and reads correctly over a Showcase hero image. Desktop keeps the breadcrumb /
 * sidebar, so this is hidden at md+.
 */
export function GalleryUpNav({ label, href }: { label: string | null; href: string | null }) {
  const t = useTranslations("gallery.view");
  if (!href || !label) return null;

  return (
    <Link
      href={href}
      aria-label={t("upToParent")}
      className="md:hidden sticky top-0 z-40 flex items-center gap-1.5 border-b border-border bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-accent"
    >
      <ChevronLeft size={18} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
