// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

// The Next *server* fetches this, so it needs an absolute backend URL — the relative `/api` proxy
// only exists in the browser. Same resolution order as app/g/[share_token]/layout.tsx.
const BACKEND =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "production" ? "http://backend:8000" : "http://localhost:8000");

export type LegalDoc = "impressum" | "privacy";

/** Fetch the page body. Returns null when unset (backend 404s) or unreachable.
 *
 * Kept separate from the component so `notFound()` is never called inside a try/catch — it works
 * by throwing a control-flow exception, which a bare `catch` would swallow into a rendered page. */
async function fetchLegalContent(doc: LegalDoc): Promise<string | null> {
  try {
    // `no-store`, not a revalidate window: a cached body keeps a *cleared* legal page reachable
    // (and an edited one stale) until the window expires. These pages are tiny and rarely hit, so
    // the per-request fetch is the right trade for always reflecting what the admin saved.
    const res = await fetch(`${BACKEND}/api/public/legal/${doc}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string };
    return body.content?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Renders a legal page (Impressum / privacy policy) from `app_settings`.
 *
 * The body is admin-authored plain text and is rendered as **text** — `whitespace-pre-line`
 * preserves the author's line breaks without `dangerouslySetInnerHTML`, so there is no stored-XSS
 * surface. An unset page 404s, which is also why the gallery footer hides its link.
 */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const content = await fetchLegalContent(doc);
  if (content === null) notFound();

  const t = await getTranslations("gallery.legal");

  // The tone lives on a full-bleed wrapper, not the centered column — putting `bg-zinc-950` on the
  // `max-w-2xl` main leaves a visible vertical seam against the page background.
  return (
    <div className="min-h-screen bg-zinc-950">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-100">{t(doc)}</h1>
        <div className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">{content}</div>
      </main>
    </div>
  );
}
