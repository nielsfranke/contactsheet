// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// The non-masonry (grid / list) layout, shared by the public PhotoGrid and the admin LayoutGrid.
// Small galleries render the original responsive CSS grid (markup unchanged). Past
// VIRTUALIZE_THRESHOLD it chunks tiles into explicit-column rows and window-virtualizes them, so
// only the on-screen rows mount. `renderTile(index, aspectSquare)` renders one tile by its global
// index — the caller owns keys + per-tile state.
import { ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { LayoutType, SizeType } from "@/lib/types";
import { GAP, GAP_PX, VIRTUALIZE_THRESHOLD, gridColumnCount, gridColumns } from "@/lib/gridLayout";
import { WindowedRows } from "@/components/WindowedRows";

export function WindowedFixedGrid({
  count,
  layout,
  size,
  spacing,
  renderTile,
}: {
  count: number;
  layout: LayoutType;
  size: SizeType;
  spacing: SizeType;
  renderTile: (index: number, aspectSquare: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const square = layout !== "list";
  const gap = GAP_PX[spacing];

  // Small galleries: the original responsive CSS grid, unchanged.
  if (count <= VIRTUALIZE_THRESHOLD || width === 0) {
    return (
      <div ref={ref} className={`grid ${gridColumns(layout, size)} ${GAP[spacing]}`}>
        {Array.from({ length: count }, (_, i) => renderTile(i, square))}
      </div>
    );
  }

  const cols = gridColumnCount(layout, size, width);
  const cellWidth = (width - gap * (cols - 1)) / cols;
  const rowCount = Math.ceil(count / cols);

  return (
    <div ref={ref}>
      <WindowedRows
        count={rowCount}
        // Initial guess only (rows self-measure): square tiles are cellWidth tall; list tiles vary.
        estimateSize={() => (square ? cellWidth : cellWidth * 0.7) + gap}
        renderRow={(ri) => (
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, paddingTop: ri > 0 ? gap : 0 }}
          >
            {Array.from({ length: Math.min(cols, count - ri * cols) }, (_, j) => renderTile(ri * cols + j, square))}
          </div>
        )}
      />
    </div>
  );
}
