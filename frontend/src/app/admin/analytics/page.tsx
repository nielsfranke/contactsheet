// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BarTimeseries } from "@/components/admin/analytics/BarTimeseries";
import { TotalsRow } from "@/components/admin/analytics/TotalsRow";
import { RangeToggle } from "@/components/admin/analytics/RangeToggle";

export default function InstanceAnalyticsPage() {
  const t = useTranslations("admin.analytics");
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "instance", days],
    queryFn: () => api.analytics.instance(days),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("instanceTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("instanceSubtitle")}</p>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </div>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <TotalsRow totals={data.totals} viewsAvailable={data.views_available} />

          <div className="grid gap-3 sm:grid-cols-2">
            {data.views_available && (
              <BarTimeseries data={data.views_series} label={t("viewsOverTime")} colorClass="bg-muted-foreground/60" totalLabel={t("total")} />
            )}
            <BarTimeseries data={data.downloads_series} label={t("downloadsOverTime")} colorClass="bg-sky-400" totalLabel={t("total")} />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium text-foreground">{t("busiestGalleries")}</h2>
            {data.busiest_galleries.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noActivity")}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("colGallery")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("views")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("downloads")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("engagement")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.busiest_galleries.map((g) => (
                      <tr key={g.gallery_id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Link href={`/admin/galleries/${g.gallery_id}`} className="text-foreground hover:underline">
                            {g.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {data.views_available ? g.totals.views : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{g.totals.downloads}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {g.totals.likes + g.totals.flags + g.totals.ratings + g.totals.comments + g.totals.annotations + g.totals.votes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
