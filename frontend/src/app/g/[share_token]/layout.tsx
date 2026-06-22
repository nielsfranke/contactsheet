// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { headers } from "next/headers";

// The Next *server* (not the browser) fetches preview metadata here, so it needs an absolute
// backend URL — the relative `/api` proxy only exists in the browser. In Docker this is the
// backend service name; in dev it mirrors next.config.ts's NEXT_PUBLIC_API_BASE fallback.
const BACKEND =
  process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type GalleryMeta = {
  name: string;
  description?: string;
  image_url?: string | null;
  instance_name?: string | null;
  password_protected?: boolean;
};

// Per-gallery Open Graph tags so a pasted share link unfurls with the gallery's name + cover
// (not the static "ContactSheet" title and instance logo). Any failure returns `{}` → the root
// layout's generic metadata stands, so a preview hiccup never breaks the page.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ share_token: string }>;
}): Promise<Metadata> {
  const { share_token } = await params;
  try {
    const res = await fetch(
      `${BACKEND}/api/public/g/${encodeURIComponent(share_token)}/meta`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return {};
    const meta: GalleryMeta = await res.json();

    // metadataBase resolves a relative image_url (when the backend's public_base_url is unset) to
    // an absolute URL — scrapers won't follow relative og:image paths.
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const metadataBase = host ? new URL(`${proto}://${host}`) : undefined;

    const images = meta.image_url ? [meta.image_url] : undefined;
    const description = meta.description || undefined;
    return {
      metadataBase,
      title: meta.name,
      description,
      openGraph: {
        type: "website",
        title: meta.name,
        description,
        siteName: meta.instance_name || "ContactSheet",
        images,
      },
      twitter: {
        card: images ? "summary_large_image" : "summary",
        title: meta.name,
        description,
        images,
      },
    };
  } catch {
    return {};
  }
}

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
