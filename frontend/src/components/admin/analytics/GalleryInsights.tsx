// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { GalleryAnalyticsPanel } from "./GalleryAnalyticsPanel";

type Tab = "analytics" | "activity";

/** Tabbed body for the gallery insights dialog: the analytics dashboard + the raw feed. */
export function GalleryInsights({ galleryId }: { galleryId: string }) {
  const t = useTranslations("admin.analytics");
  const [tab, setTab] = useState<Tab>("analytics");

  return (
    <div>
      <div className="mb-3 flex gap-1 border-b border-border">
        {(["analytics", "activity"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === "analytics" ? (
        <GalleryAnalyticsPanel galleryId={galleryId} />
      ) : (
        <ActivityFeed galleryId={galleryId} embedded />
      )}
    </div>
  );
}
