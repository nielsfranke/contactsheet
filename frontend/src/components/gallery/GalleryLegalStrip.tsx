// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";

/** Upstream project links. Hardcoded on purpose: a fork that wants its own donation target is
 * editing source anyway, and `source_url` (Settings → General) already covers fork attribution. */
const PROJECT_URL = "https://github.com/nielsfranke/contactsheet";
const SUPPORT_URL = "https://ko-fi.com/nielsfranke";

/**
 * The always-on legal strip at the bottom of every public gallery.
 *
 * Deliberately **not** gated by `footer_enabled` (which governs the photographer's optional
 * branding footer above it):
 *  - an Impressum must be reachable in one click from every public page, and
 *  - AGPL §13 makes the source offer to *network users* — the clients — so `Source` is never
 *    suppressed. Only the `Support ♥` link is toggleable (`support_link_enabled`).
 *
 * See docs/architecture/impressum-and-powered-by-strip.md.
 */
export function GalleryLegalStrip({
  sourceUrl,
  supportEnabled,
  impressumAvailable,
  privacyAvailable,
  bright,
  themed = false,
}: {
  sourceUrl: string | null;
  supportEnabled: boolean;
  impressumAvailable: boolean;
  privacyAvailable: boolean;
  bright: boolean;
  /** Use admin theme tokens instead of the public bright/dark zinc scheme (login / setup screens,
   * which live on the admin surface). Mirrors `GalleryFooter`'s `themed` prop. */
  themed?: boolean;
}) {
  const t = useTranslations("gallery.legal");

  // Fork-aware: a modified instance points this at its own repo (AGPL §13).
  const source = (sourceUrl ?? "").trim() || PROJECT_URL;

  const textCls = themed ? "text-muted-foreground" : "text-zinc-500";
  const linkCls = themed
    ? "hover:text-foreground transition-colors"
    : bright
      ? "hover:text-zinc-800 transition-colors"
      : "hover:text-zinc-300 transition-colors";
  const borderCls = themed ? "border-border" : bright ? "border-zinc-200" : "border-zinc-800";

  // Items are assembled first so the separator can be a *trailing* `after:` pseudo-element on every
  // item but the last. Rendering separators as standalone siblings lets a wrapped line begin with a
  // stray "·" (visible on the narrow login card) — this way a wrap always breaks before a label.
  const items = [
    impressumAvailable && (
      <Link key="impressum" href="/impressum" className={linkCls}>
        {t("impressum")}
      </Link>
    ),
    privacyAvailable && (
      <Link key="privacy" href="/privacy" className={linkCls}>
        {t("privacy")}
      </Link>
    ),
    <span key="powered">{t("poweredBy")}</span>,
    // AGPL §13 — never hidden.
    <a key="source" href={source} target="_blank" rel="noopener noreferrer" className={linkCls}>
      {t("source")}
    </a>,
    supportEnabled && (
      <a
        key="support"
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 ${linkCls}`}
      >
        {t("support")}
        <Heart className="size-3" aria-hidden="true" />
      </a>
    ),
  ].filter(Boolean);

  return (
    <div className={`mt-8 border-t ${borderCls} px-4 py-4`}>
      <nav
        aria-label={t("aria")}
        className={`flex flex-wrap items-center justify-center gap-y-1 text-center text-xs ${textCls}`}
      >
        {items.map((item, i) => (
          <span
            key={i}
            className={
              i < items.length - 1
                ? "after:mx-2 after:content-['·'] after:opacity-70"
                : undefined
            }
          >
            {item}
          </span>
        ))}
      </nav>
    </div>
  );
}
