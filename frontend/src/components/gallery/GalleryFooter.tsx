// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Mail, Phone } from "lucide-react";
import type { FooterSettings } from "@/lib/types";

// Brand glyphs (24×24, fill=currentColor). lucide-react dropped brand icons, so the social marks
// are inline single-path SVGs here; Mail/Phone still come from lucide.
function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const Instagram = () => <Svg d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />;
const Facebook = () => <Svg d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />;
const XMark = () => <Svg d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />;
const TikTok = () => <Svg d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />;
const YouTube = () => <Svg d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />;
const LinkedIn = () => <Svg d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />;

/** Prepend https:// when a website value has no scheme. */
function url(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Social platforms: `prefix` is the display prefix shown in the admin form (no scheme);
// `base` is the full prefix used to build an outbound URL from a bare handle.
export const SOCIAL_META: Record<string, { prefix: string; base: string }> = {
  instagram: { prefix: "instagram.com/", base: "https://instagram.com/" },
  facebook: { prefix: "facebook.com/", base: "https://facebook.com/" },
  x: { prefix: "x.com/", base: "https://x.com/" },
  tiktok: { prefix: "tiktok.com/@", base: "https://tiktok.com/@" },
  youtube: { prefix: "youtube.com/@", base: "https://youtube.com/@" },
  linkedin: { prefix: "linkedin.com/in/", base: "https://linkedin.com/in/" },
};

// Matches an entered value that already carries the platform domain (with or without scheme/@),
// so legacy full-URL values keep working and the admin form can strip them back to a handle.
const SOCIAL_DOMAIN: Record<string, RegExp> = {
  instagram: /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?/i,
  facebook: /^(?:https?:\/\/)?(?:www\.)?facebook\.com\//i,
  x: /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?/i,
  tiktok: /^(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@?/i,
  youtube: /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/@?/i,
  linkedin: /^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in\/)?/i,
};

/** Reduce a stored social value (bare handle or full URL) to a bare handle for editing. */
export function socialHandle(key: string, value: string): string {
  let t = value.trim();
  const d = SOCIAL_DOMAIN[key];
  if (d) t = t.replace(d, "");
  return t.replace(/^@+/, "").replace(/\/+$/, "");
}

/** Build the outbound URL for a social value that may be a bare handle or a full URL. */
function socialUrl(key: string, value: string): string {
  const t = value.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (SOCIAL_DOMAIN[key]?.test(t) || /^[\w.-]+\.[a-z]{2,}\//i.test(t)) return `https://${t}`;
  const meta = SOCIAL_META[key];
  return meta ? meta.base + socialHandle(key, t) : `https://${t}`;
}

// Default order of the contact/social icons (mirrors backend FOOTER_ICON_KEYS).
const ICON_KEYS = ["email", "phone", "instagram", "facebook", "x", "tiktok", "youtube", "linkedin"] as const;

// Key → label + glyph, in default order. Exported for the admin reorder UI.
export const FOOTER_ICON_META: { key: string; label: string; node: React.ReactNode }[] = [
  { key: "email", label: "Email", node: <Mail size={16} /> },
  { key: "phone", label: "Phone", node: <Phone size={16} /> },
  { key: "instagram", label: "Instagram", node: <Instagram /> },
  { key: "facebook", label: "Facebook", node: <Facebook /> },
  { key: "x", label: "X / Twitter", node: <XMark /> },
  { key: "tiktok", label: "TikTok", node: <TikTok /> },
  { key: "youtube", label: "YouTube", node: <YouTube /> },
  { key: "linkedin", label: "LinkedIn", node: <LinkedIn /> },
];

export function GalleryFooter({
  footer,
  accent,
  bright,
  themed = false,
}: {
  footer: FooterSettings;
  accent: string;
  bright: boolean;
  /** Use admin theme tokens instead of the public bright/dark zinc scheme (for the admin preview). */
  themed?: boolean;
}) {
  const tl = useTranslations("gallery.footerLabels");
  // email → mailto:, phone → tel: (digits/+ only), socials/website → normalized URL.
  // Brand names (Instagram, X, …) stay literal; only the generic email/phone labels localize.
  const byKey: Record<string, { label: string; href: string; icon: React.ReactNode } | undefined> = {
    email: footer.email ? { label: tl("email"), href: `mailto:${footer.email}`, icon: <Mail size={18} /> } : undefined,
    phone: footer.phone ? { label: tl("phone"), href: `tel:${footer.phone.replace(/[^\d+]/g, "")}`, icon: <Phone size={18} /> } : undefined,
    instagram: footer.instagram ? { label: "Instagram", href: socialUrl("instagram", footer.instagram), icon: <Instagram /> } : undefined,
    facebook: footer.facebook ? { label: "Facebook", href: socialUrl("facebook", footer.facebook), icon: <Facebook /> } : undefined,
    x: footer.x ? { label: "X", href: socialUrl("x", footer.x), icon: <XMark /> } : undefined,
    tiktok: footer.tiktok ? { label: "TikTok", href: socialUrl("tiktok", footer.tiktok), icon: <TikTok /> } : undefined,
    youtube: footer.youtube ? { label: "YouTube", href: socialUrl("youtube", footer.youtube), icon: <YouTube /> } : undefined,
    linkedin: footer.linkedin ? { label: "LinkedIn", href: socialUrl("linkedin", footer.linkedin), icon: <LinkedIn /> } : undefined,
  };
  // Saved order first, then any remaining keys in the default order; only filled-in ones render.
  const orderedKeys = [...(footer.icon_order ?? []), ...ICON_KEYS].filter(
    (k, i, arr) => arr.indexOf(k) === i && byKey[k],
  );
  const links = orderedKeys.map((key) => ({ key, ...byKey[key]! }));

  const hasText = footer.business_name || footer.website_url;
  if (!hasText && links.length === 0) return null;

  const nameCls = themed ? "text-foreground" : bright ? "text-zinc-800" : "text-zinc-200";
  const linkCls = themed
    ? "text-muted-foreground hover:text-foreground"
    : bright
      ? "text-zinc-500 hover:text-zinc-800"
      : "text-zinc-500 hover:text-zinc-300";
  const borderCls = themed ? "border-border" : bright ? "border-zinc-200" : "border-zinc-800";
  const websiteLabel = footer.website_url?.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  return (
    <footer className={`mt-16 border-t ${borderCls} pt-10 pb-12 flex flex-col items-center gap-3 text-center`}>
      {footer.business_name && (
        <p className={`text-sm font-semibold uppercase tracking-wide ${nameCls}`}>{footer.business_name}</p>
      )}
      {footer.website_url && (
        <a
          href={url(footer.website_url)}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs uppercase tracking-wide transition-colors ${linkCls}`}
        >
          {websiteLabel}
        </a>
      )}
      {links.length > 0 && (
        <div className="flex items-center gap-3 mt-1">
          {links.map((l) => (
            <a
              key={l.key}
              href={l.href}
              target={l.href.startsWith("http") ? "_blank" : undefined}
              rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
              aria-label={l.label}
              title={l.label}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-[opacity,filter] hover:brightness-110 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              style={{ backgroundColor: accent }}
            >
              {l.icon}
            </a>
          ))}
        </div>
      )}
    </footer>
  );
}
