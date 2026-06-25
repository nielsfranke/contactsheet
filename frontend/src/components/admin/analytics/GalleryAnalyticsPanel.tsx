// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Eye, Heart, Flag, MessageCircle, Star, Info } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BarTimeseries } from "./BarTimeseries";
import { TotalsRow } from "./TotalsRow";
import { RangeToggle } from "./RangeToggle";
import type { TopImage } from "@/lib/types";

const BREAKDOWN_ICONS: Record<string, React.ReactNode> = {
  liked: <Heart size={11} className="text-pink-400" />,
  flagged: <Flag size={11} className="text-yellow-400" />,
  rated: <Star size={11} className="text-amber-400" />,
  voted: <Star size={11} className="text-orange-400" />,
  commented: <MessageCircle size={11} className="text-blue-400" />,
  annotated: <MessageCircle size={11} className="text-purple-400" />,
};

function TopImageCard({ item }: { item: TopImage }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/50">
      <div className="aspect-square bg-muted">
        {item.image.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image.thumb_url} alt={item.image.original_filename} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 p-1.5 text-[11px] text-muted-foreground">
        {Object.entries(item.breakdown).map(([action, count]) => (
          <span key={action} className="inline-flex items-center gap-0.5">
            {BREAKDOWN_ICONS[action] ?? null}
            {count}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GalleryAnalyticsPanel({ galleryId }: { galleryId: string }) {
  const t = useTranslations("admin.analytics");
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "gallery", galleryId, days],
    queryFn: () => api.analytics.gallery(galleryId, days),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <RangeToggle value={days} onChange={setDays} />
      </div>

      <TotalsRow totals={data.totals} viewsAvailable={data.views_available} />

      {!data.views_available && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            {t("viewsDisabled")}{" "}
            <Link href="/admin/settings/general" className="underline hover:text-foreground">
              {t("viewsDisabledLink")}
            </Link>
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {data.views_available && (
          <BarTimeseries data={data.views_series} label={t("viewsOverTime")} totalLabel={t("total")} />
        )}
        <BarTimeseries data={data.downloads_series} label={t("downloadsOverTime")} totalLabel={t("total")} />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium text-foreground">{t("topPhotos")}</h4>
        {data.top_images.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noEngagement")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {data.top_images.map((item) => (
              <TopImageCard key={item.image.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {data.views_available && data.recent_visitors.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-foreground">{t("recentVisitors")}</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.recent_visitors.map((v, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Eye size={12} />
                  <span className="font-mono">{v.ip ?? "—"}</span>
                </span>
                <time className="text-muted-foreground/70">{new Date(v.at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
