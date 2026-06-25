// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo } from "react";
import { chartBars, seriesTotal } from "@/lib/analytics";
import type { TimeseriesPoint } from "@/lib/types";

interface Props {
  data: TimeseriesPoint[];
  label: string;
  /** Localized total suffix, e.g. "total". */
  totalLabel?: string;
}

// Bars use the instance accent (--primary), honouring the optional accent gradient — same recipe as
// the primary buttons, so the charts stay on-brand when the photographer picks a custom accent.
const BAR_FILL = "bg-primary [html.accent-gradient_&]:bg-[image:var(--primary-gradient)]";

/**
 * Hand-rolled daily bar chart — no chart dependency. Bars are flex children sized
 * by percentage of the series max (see chartBars); each carries a native title for
 * an at-a-glance tooltip (date + count). Empty/zero series render a flat baseline.
 */
export function BarTimeseries({ data, label, totalLabel }: Props) {
  const bars = useMemo(() => chartBars(data), [data]);
  const total = useMemo(() => seriesTotal(data), [data]);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total} {totalLabel}
        </span>
      </div>
      <div className="flex h-24 items-end gap-px" role="img" aria-label={`${label}: ${total}`}>
        {bars.map((b) => (
          <div
            key={b.date}
            className="group relative flex-1"
            title={`${b.date} · ${b.count}`}
          >
            {/* Track ensures even zero days have a hover target + faint baseline. */}
            <div className="flex h-24 items-end">
              <div
                className={`w-full rounded-sm ${b.count > 0 ? BAR_FILL : "bg-muted"} transition-opacity group-hover:opacity-70`}
                style={{ height: `${Math.max(b.pct * 100, b.count > 0 ? 4 : 2)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
