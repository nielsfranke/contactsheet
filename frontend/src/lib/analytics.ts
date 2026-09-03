// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimeseriesPoint } from "./types";

export interface ChartBar {
  date: string;
  count: number;
  /** Height as a fraction 0..1 of the chart, relative to the series max. */
  pct: number;
}

/**
 * Scale a timeseries into bar heights relative to the series maximum. Pure so the
 * BarTimeseries component stays presentational and this stays unit-testable.
 * An all-zero (or empty) series yields all-zero heights — no divide-by-zero, no
 * misleading full-height bars.
 */
export function chartBars(points: TimeseriesPoint[]): ChartBar[] {
  const max = points.reduce((m, p) => Math.max(m, p.count), 0);
  return points.map((p) => ({
    date: p.date,
    count: p.count,
    pct: max > 0 ? p.count / max : 0,
  }));
}

export function seriesTotal(points: TimeseriesPoint[]): number {
  return points.reduce((sum, p) => sum + p.count, 0);
}

export type Trend = { kind: "up" | "down" | "flat"; pct: number } | { kind: "new" } | { kind: "none" };

/**
 * Period-over-period change for a stat tile. `new` = activity where the previous window had
 * none (no meaningful percentage); `none` = both windows empty. Percentages are rounded and
 * relative to the previous window.
 */
export function trend(current: number, previous: number): Trend {
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { kind: "flat", pct: 0 };
  return { kind: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
}

/** Share of `part` in `total` as a 0..100 integer; 0 when total is 0 (no divide-by-zero). */
export function pctOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
