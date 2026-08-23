// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GalleryLegalStrip } from "@/components/gallery/GalleryLegalStrip";

type Legal = {
  source_url: string | null;
  support_link_enabled: boolean;
  impressum_available: boolean;
  privacy_available: boolean;
};

/**
 * The legal strip for the screens that render before a gallery (or the admin) is known: `/login`,
 * `/setup`, and the public gallery status screens (password gate, expired, not found).
 *
 * Same rationale as the gallery strip: an Impressum must be reachable from every public page, and
 * the AGPL §13 source offer is made to anyone who can reach the app — including someone staring at
 * the login form or a dead link. `themed` (default) uses the admin tokens for `/login` + `/setup`;
 * the gallery status screens pass `themed={false}` for the public dark-zinc scheme.
 *
 * Reads the already-public `GET /api/setup/status` (which the login screen also uses for branding),
 * so no new endpoint and no auth. Renders nothing until it resolves, and nothing at all on failure —
 * a legal link must never be the reason a login page fails to appear.
 */
export function AuthLegalStrip({ themed = true }: { themed?: boolean }) {
  const [legal, setLegal] = useState<Legal | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.setup
      .status()
      .then((s) => {
        if (!cancelled) setLegal(s);
      })
      .catch(() => {
        /* non-fatal: the page renders without the strip */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!legal) return null;

  return (
    <div className={themed ? "w-full max-w-sm" : "w-full"}>
      <GalleryLegalStrip
        themed={themed}
        bright={false}
        sourceUrl={legal.source_url}
        supportEnabled={legal.support_link_enabled}
        impressumAvailable={legal.impressum_available}
        privacyAvailable={legal.privacy_available}
      />
    </div>
  );
}
