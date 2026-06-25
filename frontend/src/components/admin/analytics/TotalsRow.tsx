// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Eye, Download, Heart, Flag, MessageCircle, Star } from "lucide-react";
import { StatTile } from "./StatTile";
import type { EngagementTotals } from "@/lib/types";

interface Props {
  totals: EngagementTotals;
  /** When false, the views tile is dimmed with an em-dash (IP logging off). */
  viewsAvailable: boolean;
}

export function TotalsRow({ totals, viewsAvailable }: Props) {
  const t = useTranslations("admin.analytics");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label={t("views")}
        value={viewsAvailable ? totals.views : "—"}
        icon={<Eye size={13} />}
        muted={!viewsAvailable}
      />
      <StatTile label={t("downloads")} value={totals.downloads} icon={<Download size={13} />} />
      <StatTile label={t("likes")} value={totals.likes} icon={<Heart size={13} />} />
      <StatTile label={t("flags")} value={totals.flags} icon={<Flag size={13} />} />
      <StatTile label={t("ratings")} value={totals.ratings} icon={<Star size={13} />} />
      <StatTile
        label={t("comments")}
        value={totals.comments + totals.annotations}
        icon={<MessageCircle size={13} />}
      />
    </div>
  );
}
