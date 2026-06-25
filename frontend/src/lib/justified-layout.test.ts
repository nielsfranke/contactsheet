// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { computeJustifiedRows } from "./justified-layout";

interface Tile {
  id: string;
  a: number; // aspect ratio (w/h)
}

const aspect = (t: Tile) => t.a;

describe("computeJustifiedRows", () => {
  it("returns no rows before the container is measured", () => {
    expect(computeJustifiedRows([{ id: "a", a: 1.5 }], aspect, 0, 240, 8)).toEqual([]);
  });

  it("keeps square tiles on one row when they fit at/above the target height", () => {
    // 3 squares, width 1000, gap 8, target 240. Single-row height = (1000 - 16)/3 = 328 > 240,
    // so the row only flushes as the trailing row at min(328, 240) = 240.
    const items: Tile[] = [
      { id: "a", a: 1 },
      { id: "b", a: 1 },
      { id: "c", a: 1 },
    ];
    const rows = computeJustifiedRows(items, aspect, 1000, 240, 8);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(240);
    expect(rows[0].cells.map((c) => c.item.id)).toEqual(["a", "b", "c"]);
    // Square → width === height at the trailing target.
    expect(rows[0].cells[0].width).toBe(240);
  });

  it("breaks into a new row once candidates fill the width at/below the target", () => {
    // Many wide tiles: a full row of 16:9 (a≈1.778) tiles fills 1000px well under 240 target.
    const wide: Tile[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, a: 16 / 9 }));
    const rows = computeJustifiedRows(wide, aspect, 1000, 240, 8);
    expect(rows.length).toBeGreaterThan(1);
    // Every non-trailing row fills the width exactly: sum(cellWidths) + gaps ≈ containerWidth.
    for (const row of rows.slice(0, -1)) {
      const total = row.cells.reduce((s, c) => s + c.width, 0) + 8 * (row.cells.length - 1);
      expect(total).toBeCloseTo(1000, 5);
      expect(row.height).toBeLessThanOrEqual(240);
    }
  });

  it("preserves global index across rows (for lightbox sequencing)", () => {
    const wide: Tile[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, a: 16 / 9 }));
    const rows = computeJustifiedRows(wide, aspect, 1000, 240, 8);
    const flat = rows.flatMap((r) => r.cells.map((c) => c.index));
    expect(flat).toEqual([...Array(12).keys()]);
  });

  it("scales cell width by aspect at the row height", () => {
    const items: Tile[] = [
      { id: "p", a: 0.5 }, // portrait
      { id: "l", a: 2.0 }, // landscape
    ];
    const rows = computeJustifiedRows(items, aspect, 400, 240, 0);
    // Trailing row at min(h, 240). h = 400 / (0.5 + 2.0) = 160 → height 160.
    expect(rows[0].height).toBe(160);
    expect(rows[0].cells[0].width).toBeCloseTo(80, 5); // 0.5 * 160
    expect(rows[0].cells[1].width).toBeCloseTo(320, 5); // 2.0 * 160
  });
});
