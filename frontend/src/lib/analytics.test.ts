// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { chartBars, seriesTotal } from "./analytics";

describe("chartBars", () => {
  it("scales heights relative to the series max", () => {
    const bars = chartBars([
      { date: "2026-06-01", count: 0 },
      { date: "2026-06-02", count: 5 },
      { date: "2026-06-03", count: 10 },
    ]);
    expect(bars.map((b) => b.pct)).toEqual([0, 0.5, 1]);
  });

  it("returns all-zero heights for an all-zero series (no divide-by-zero)", () => {
    const bars = chartBars([
      { date: "2026-06-01", count: 0 },
      { date: "2026-06-02", count: 0 },
    ]);
    expect(bars.every((b) => b.pct === 0)).toBe(true);
  });

  it("handles an empty series", () => {
    expect(chartBars([])).toEqual([]);
  });
});

describe("seriesTotal", () => {
  it("sums counts", () => {
    expect(seriesTotal([{ date: "a", count: 2 }, { date: "b", count: 3 }])).toBe(5);
  });
});
