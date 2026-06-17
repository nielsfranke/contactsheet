// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";

export function GalleryExpired() {
  const t = useTranslations("gallery.expired");
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center space-y-4 px-6">
        <div className="flex justify-center">
          <Clock size={48} className="text-zinc-600" />
        </div>
        <h1 className="text-xl font-semibold text-zinc-200">{t("title")}</h1>
        <p className="text-zinc-500 text-sm max-w-xs">{t("body")}</p>
      </div>
    </div>
  );
}
