// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { chartBars, seriesTotal, trend, pctOf } from "./analytics";

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

describe("trend", () => {
  it("reports growth relative to the previous window", () => {
    expect(trend(15, 10)).toEqual({ kind: "up", pct: 50 });
    expect(trend(5, 10)).toEqual({ kind: "down", pct: 50 });
    expect(trend(10, 10)).toEqual({ kind: "flat", pct: 0 });
  });
  it("marks a first-time signal as new and an empty pair as none", () => {
    expect(trend(3, 0)).toEqual({ kind: "new" });
    expect(trend(0, 0)).toEqual({ kind: "none" });
  });
});

describe("pctOf", () => {
  it("rounds and survives an empty total", () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(0, 0)).toBe(0);
  });
});
