// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Eye, Download, Heart, Flag, MessageCircle, Star, Upload, Users } from "lucide-react";
import { StatTile } from "./StatTile";
import type { EngagementTotals } from "@/lib/types";

interface Props {
  totals: EngagementTotals;
  /** The same totals for the previous window — enables the per-tile trend. */
  previous?: EngagementTotals;
  days?: number;
  /** When false, the views tile is dimmed with an em-dash (IP logging off). */
  viewsAvailable: boolean;
}

/**
 * Six core tiles always; uploads (client uploads) and votes (team voting) appear only once the
 * instance has any in either window, so galleries that don't use those features stay uncluttered.
 */
export function TotalsRow({ totals, previous, days, viewsAvailable }: Props) {
  const t = useTranslations("admin.analytics");
  const show = (k: "uploads" | "votes") => totals[k] > 0 || (previous?.[k] ?? 0) > 0;
  const extra = (show("uploads") ? 1 : 0) + (show("votes") ? 1 : 0);
  return (
    <div
      className={
        extra === 0
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          : "grid grid-cols-2 gap-2 sm:grid-cols-4"
      }
    >
      <StatTile
        label={t("views")}
        value={viewsAvailable ? totals.views : "—"}
        icon={<Eye size={13} />}
        muted={!viewsAvailable}
        previous={previous?.views}
        days={days}
      />
      <StatTile label={t("downloads")} value={totals.downloads} icon={<Download size={13} />} previous={previous?.downloads} days={days} />
      <StatTile label={t("likes")} value={totals.likes} icon={<Heart size={13} />} previous={previous?.likes} days={days} />
      <StatTile label={t("flags")} value={totals.flags} icon={<Flag size={13} />} previous={previous?.flags} days={days} />
      <StatTile label={t("ratings")} value={totals.ratings} icon={<Star size={13} />} previous={previous?.ratings} days={days} />
      <StatTile
        label={t("comments")}
        value={totals.comments + totals.annotations}
        icon={<MessageCircle size={13} />}
        previous={previous ? previous.comments + previous.annotations : undefined}
        days={days}
      />
      {show("votes") && (
        <StatTile label={t("votes")} value={totals.votes} icon={<Users size={13} />} previous={previous?.votes} days={days} />
      )}
      {show("uploads") && (
        <StatTile label={t("uploads")} value={totals.uploads} icon={<Upload size={13} />} previous={previous?.uploads} days={days} />
      )}
    </div>
  );
}
