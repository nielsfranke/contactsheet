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
