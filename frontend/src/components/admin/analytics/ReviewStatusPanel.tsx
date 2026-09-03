// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Heart, MessageCircle, Star, Users } from "lucide-react";
import { pctOf } from "@/lib/analytics";
import { showsFlags, showsStars, type ColorFlag, type RatingMode, type ReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  status: ReviewStatus;
  ratingMode: RatingMode;
}

// Same swatches as the toolbar's flag chips so a colour means the same thing everywhere.
const FLAG_ORDER: { value: ColorFlag; bg: string }[] = [
  { value: "green", bg: "bg-green-500" },
  { value: "yellow", bg: "bg-yellow-400" },
  { value: "red", bg: "bg-red-500" },
  { value: "blue", bg: "bg-blue-400" },
  { value: "none", bg: "bg-muted-foreground/25" },
];

const BAR_FILL = "bg-primary [html.accent-gradient_&]:bg-[image:var(--primary-gradient)]";

/**
 * "Where does the selection stand?" — a snapshot of the live images (not activity history):
 * how many carry any mark, the shared flag split as one stacked bar, the shared star histogram,
 * and the like / comment / team-voter counts. Which of flags/stars show follows the instance
 * rating_mode; both systems keep their data either way (see docs/architecture/rating-mode-both.md).
 */
export function ReviewStatusPanel({ status, ratingMode }: Props) {
  const t = useTranslations("admin.analytics");
  const ta = useTranslations("admin.activity");
  const { images, reviewed } = status;
  const reviewedPct = pctOf(reviewed, images);
  const flagged = images - status.flags.none;
  const rated = status.ratings.slice(1).reduce((a, b) => a + b, 0);
  const starMax = Math.max(1, ...status.ratings.slice(1));

  if (images === 0) {
    return <p className="text-xs text-muted-foreground">{t("noPhotos")}</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/50 p-3">
      {/* Coverage: reviewed / total */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-medium text-foreground">{t("reviewedOf", { reviewed, total: images })}</span>
          <span className="tabular-nums text-muted-foreground">{reviewedPct} %</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={images}
          aria-valuenow={reviewed}
          aria-label={t("reviewedOf", { reviewed, total: images })}
        >
          <div className={cn("h-full rounded-full transition-[width]", BAR_FILL)} style={{ width: `${reviewedPct}%` }} />
        </div>
      </div>

      <div className={cn("grid gap-4", showsFlags(ratingMode) && showsStars(ratingMode) && "sm:grid-cols-2")}>
        {/* Flag split — one stacked bar + legend */}
        {showsFlags(ratingMode) && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium text-foreground">{t("flagSplit")}</span>
              <span className="tabular-nums text-muted-foreground">{t("flaggedOf", { flagged, total: images })}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("flagSplit")}>
              {FLAG_ORDER.map((f) => {
                const n = status.flags[f.value];
                return n > 0 ? (
                  <div key={f.value} className={f.bg} style={{ width: `${(n / images) * 100}%` }} title={`${f.value === "none" ? t("unflagged") : ta(`flagColors.${f.value}`)} · ${n}`} />
                ) : null;
              })}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {FLAG_ORDER.map((f) => (
                <li key={f.value} className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2 w-2 rounded-full", f.bg)} aria-hidden />
                  <span className="capitalize">{f.value === "none" ? t("unflagged") : ta(`flagColors.${f.value}`)}</span>
                  <span className="tabular-nums text-foreground">{status.flags[f.value]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Star histogram — 5 rows, widest = most common */}
        {showsStars(ratingMode) && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium text-foreground">{t("starSplit")}</span>
              <span className="tabular-nums text-muted-foreground">{t("ratedOf", { rated, total: images })}</span>
            </div>
            <ul className="space-y-1" role="img" aria-label={t("starSplit")}>
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = status.ratings[stars] ?? 0;
                return (
                  <li key={stars} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex w-9 items-center justify-end gap-0.5 tabular-nums">
                      {stars} <Star size={10} className="fill-current text-amber-400" aria-hidden />
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full rounded-full", n > 0 ? "bg-amber-400" : "")} style={{ width: `${(n / starMax) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right tabular-nums text-foreground">{n}</span>
                  </li>
                );
              })}
              <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-9 text-right">{t("unrated")}</span>
                <span className="flex-1" />
                <span className="w-6 text-right tabular-nums text-foreground">{status.ratings[0] ?? 0}</span>
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Secondary marks */}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-1">
          <Heart size={11} aria-hidden /> <dt>{t("likedPhotos")}</dt>
          <dd className="tabular-nums text-foreground">{status.liked}</dd>
        </div>
        <div className="inline-flex items-center gap-1">
          <MessageCircle size={11} aria-hidden /> <dt>{t("commentedPhotos")}</dt>
          <dd className="tabular-nums text-foreground">{status.commented}</dd>
        </div>
        {status.voters > 0 && (
          <div className="inline-flex items-center gap-1">
            <Users size={11} aria-hidden /> <dt>{t("voters")}</dt>
            <dd className="tabular-nums text-foreground">{status.voters}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
