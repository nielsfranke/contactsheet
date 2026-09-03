// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { trend } from "@/lib/analytics";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number | string;
  icon?: ReactNode;
  /** Dimmed presentation for unavailable metrics (e.g. views when IP logging is off). */
  muted?: boolean;
  /** Period-over-period comparison: the same metric in the previous window of `days`. */
  previous?: number;
  days?: number;
}

/**
 * Big-number tile with an optional trend line. The trend compares the current window with the
 * equally long window before it — "+40 %", "−12 %", "new" (no prior activity) or a flat dash.
 * Omitted while muted (a comparison of unavailable data would be noise).
 */
export function StatTile({ label, value, icon, muted = false, previous, days }: Props) {
  const t = useTranslations("admin.analytics");
  const tr = !muted && typeof value === "number" && previous !== undefined ? trend(value, previous) : null;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? "text-muted-foreground/50" : "text-foreground"}`}>
        {value}
      </div>
      {tr && tr.kind !== "none" && (
        <div
          className={cn(
            "mt-0.5 inline-flex items-center gap-0.5 text-[11px] tabular-nums",
            tr.kind === "up" && "text-emerald-600 dark:text-emerald-400",
            tr.kind === "down" && "text-muted-foreground",
            (tr.kind === "flat" || tr.kind === "new") && "text-muted-foreground",
          )}
          title={days ? t("vsPrevious", { days }) : undefined}
        >
          {tr.kind === "up" && <ArrowUpRight size={11} aria-hidden />}
          {tr.kind === "down" && <ArrowDownRight size={11} aria-hidden />}
          {tr.kind === "flat" && <Minus size={11} aria-hidden />}
          <span>
            {tr.kind === "new" ? t("trendNew") : tr.kind === "flat" ? "0 %" : `${tr.kind === "up" ? "+" : "−"}${tr.pct} %`}
          </span>
          {days && <span className="sr-only">{t("vsPrevious", { days })}</span>}
        </div>
      )}
    </div>
  );
}
