// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Justified-rows photo layout (Flickr style): each row is filled edge-to-edge by
// scaling its height around a target, preserving every image's aspect ratio. Shared by the
// public PhotoGrid and the admin AdminImageGrid so both render the "masonry" layout identically.
// Past VIRTUALIZE_THRESHOLD items the rows are window-virtualized (only on-screen rows mount);
// below it the markup is byte-identical to the pre-virtualization version.
import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

import { computeJustifiedRows, type JustifiedRow } from "@/lib/justified-layout";
import { VIRTUALIZE_THRESHOLD } from "@/lib/gridLayout";
import { WindowedRows } from "@/components/WindowedRows";

interface Props<T> {
  items: T[];
  itemKey: (item: T) => string;
  /** width / height of the item; pre-clamped fallbacks are the caller's job. */
  aspect: (item: T) => number;
  targetRowHeight: number;
  /** Gap between tiles in px (both axes). */
  gap: number;
  /** Render one tile; it is wrapped in a width-sized cell, so size the media to `height`. */
  renderItem: (item: T, index: number, height: number) => ReactNode;
  /** Opt out of windowing — needed for dnd-kit sortable, which must keep every tile mounted to
   *  compute reordering. Defaults to true (the public viewer + browse views window large lists). */
  virtualize?: boolean;
}

export function JustifiedGrid<T>({ items, itemKey, aspect, targetRowHeight, gap, renderItem, virtualize: virtualizeProp = true }: Props<T>) {
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

  const rows = useMemo(
    () => computeJustifiedRows(items, aspect, width, targetRowHeight, gap),
    [items, aspect, width, targetRowHeight, gap],
  );

  // One justified row of width-sized cells. `topGap` is included so the windowed slot measures the
  // inter-row spacing too (the first row, and every row in the non-windowed path, gets it via flow).
  const row = (r: JustifiedRow<T>, topGap: boolean) => (
    <div className="flex" style={{ gap, marginTop: topGap ? gap : 0 }}>
      {r.cells.map(({ item, index, width: w }) => (
        <div key={itemKey(item)} className="min-w-0 shrink-0" style={{ width: w }}>
          {renderItem(item, index, r.height)}
        </div>
      ))}
    </div>
  );

  const virtualize = virtualizeProp && items.length > VIRTUALIZE_THRESHOLD && width > 0;

  return (
    <div ref={ref} className="w-full">
      {virtualize ? (
        <WindowedRows
          count={rows.length}
          estimateSize={(i) => rows[i].height + (i > 0 ? gap : 0)}
          renderRow={(i) => row(rows[i], i > 0)}
        />
      ) : (
        rows.map((r, ri) => <div key={ri}>{row(r, ri > 0)}</div>)
      )}
    </div>
  );
}
