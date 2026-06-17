// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Justified-rows photo layout (Flickr style): each row is filled edge-to-edge by
// scaling its height around a target, preserving every image's aspect ratio. Shared by the
// public PhotoGrid and the admin AdminImageGrid so both render the "masonry" layout identically.
import { ReactNode, useLayoutEffect, useRef, useState } from "react";

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
}

interface Row<T> {
  height: number;
  cells: { item: T; index: number; width: number }[];
}

export function JustifiedGrid<T>({ items, itemKey, aspect, targetRowHeight, gap, renderItem }: Props<T>) {
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

  const rows: Row<T>[] = [];
  if (width > 0) {
    let pending: { item: T; index: number; a: number }[] = [];
    let aspectSum = 0;

    const flush = (height: number) => {
      rows.push({
        height,
        cells: pending.map(({ item, index, a }) => ({ item, index, width: a * height })),
      });
      pending = [];
      aspectSum = 0;
    };

    items.forEach((item, index) => {
      const a = aspect(item);
      pending.push({ item, index, a });
      aspectSum += a;
      // Height at which the current candidates exactly fill the row.
      const h = (width - gap * (pending.length - 1)) / aspectSum;
      if (h <= targetRowHeight) flush(h);
    });
    // Trailing row: render at the target height, left-aligned, never stretched.
    if (pending.length) {
      const h = (width - gap * (pending.length - 1)) / aspectSum;
      flush(Math.min(h, targetRowHeight));
    }
  }

  return (
    <div ref={ref} className="w-full">
      {rows.map((row, ri) => (
        <div key={ri} className="flex" style={{ gap, marginTop: ri > 0 ? gap : 0 }}>
          {row.cells.map(({ item, index, width: w }) => (
            <div key={itemKey(item)} className="min-w-0 shrink-0" style={{ width: w }}>
              {renderItem(item, index, row.height)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
