// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { AuthLegalStrip } from "@/components/legal/AuthLegalStrip";

/**
 * Shared scaffold for the public gallery screens that render *instead of* a gallery — the password
 * gate, the expired notice, and the not-found state. Centers its content on the dark public
 * surface and keeps the legal strip at the bottom: an Impressum must be one click from every
 * public page, and these screens are exactly where a confused visitor lands.
 */
export function GalleryStatusScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex flex-1 items-center justify-center px-6 py-12">{children}</div>
      <AuthLegalStrip themed={false} />
    </div>
  );
}
