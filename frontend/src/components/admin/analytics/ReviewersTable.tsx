// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Flag, Heart, MessageCircle, Star, Upload, Users } from "lucide-react";
import type { ReviewerEntry } from "@/lib/types";

interface Props {
  reviewers: ReviewerEntry[];
}

// Column order mirrors the review flow: flag → star → like → team vote → comment → upload.
const COLUMNS: { key: string; labelKey: string; icon: React.ReactNode; actions: string[] }[] = [
  { key: "flags", labelKey: "flags", icon: <Flag size={12} />, actions: ["flagged"] },
  { key: "ratings", labelKey: "ratings", icon: <Star size={12} />, actions: ["rated"] },
  { key: "likes", labelKey: "likes", icon: <Heart size={12} />, actions: ["liked"] },
  { key: "votes", labelKey: "votes", icon: <Users size={12} />, actions: ["voted"] },
  { key: "comments", labelKey: "comments", icon: <MessageCircle size={12} />, actions: ["commented", "annotated"] },
  { key: "uploads", labelKey: "uploads", icon: <Upload size={12} />, actions: ["uploaded"] },
];

function sumActions(bd: Record<string, number>, actions: string[]) {
  return actions.reduce((n, a) => n + (bd[a] ?? 0), 0);
}

function relativeTime(iso: string, ta: ReturnType<typeof useTranslations>): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return ta("secondsAgo", { n: secs });
  const mins = Math.round(secs / 60);
  if (mins < 60) return ta("minutesAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return ta("hoursAgo", { n: hours });
  return ta("daysAgo", { n: Math.round(hours / 24) });
}

/**
 * Who did what: named clients ranked by engagement in the window. Columns for a feature nobody
 * used in this set collapse so a plain flags-only review reads as two columns, not six.
 */
export function ReviewersTable({ reviewers }: Props) {
  const t = useTranslations("admin.analytics");
  const ta = useTranslations("admin.activity");
  const cols = COLUMNS.filter((c) => reviewers.some((r) => sumActions(r.breakdown, c.actions) > 0));
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t("colReviewer")}</th>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right font-medium" title={t(c.labelKey)}>
                <span className="inline-flex items-center gap-1">
                  {c.icon}
                  <span className="sr-only sm:not-sr-only">{t(c.labelKey)}</span>
                </span>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">{t("colLastActive")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reviewers.map((r) => (
            <tr key={r.name} className="hover:bg-muted/30">
              <td className="max-w-[12rem] truncate px-3 py-1.5 font-medium text-foreground">{r.name}</td>
              {cols.map((c) => {
                const n = sumActions(r.breakdown, c.actions);
                return (
                  <td key={c.key} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {n > 0 ? n : <span className="text-muted-foreground/40">·</span>}
                  </td>
                );
              })}
              <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-muted-foreground/70" title={new Date(r.last_active).toLocaleString()}>
                {relativeTime(r.last_active, ta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
