// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure justified-rows layout math (Flickr style): each row is filled edge-to-edge by scaling its
// height around a target, preserving every image's aspect ratio. Extracted from JustifiedGrid so it
// can be unit-tested and reused by the (virtualized) renderer — the row breaks + heights must stay
// pixel-identical to the previous inline implementation.

export interface JustifiedCell<T> {
  item: T;
  index: number;
  /** Computed pixel width of this cell at the row's height. */
  width: number;
}

export interface JustifiedRow<T> {
  /** Pixel height shared by every cell in the row. */
  height: number;
  cells: JustifiedCell<T>[];
}

/**
 * Break `items` into justified rows for a given container width.
 *
 * A row is flushed once its candidates would fill the width at or below `targetRowHeight`; the
 * trailing row is rendered at the target height, left-aligned, never stretched. Returns `[]` for a
 * non-positive width (caller hasn't measured yet).
 */
export function computeJustifiedRows<T>(
  items: T[],
  aspect: (item: T) => number,
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): JustifiedRow<T>[] {
  const rows: JustifiedRow<T>[] = [];
  if (containerWidth <= 0) return rows;

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
    const h = (containerWidth - gap * (pending.length - 1)) / aspectSum;
    if (h <= targetRowHeight) flush(h);
  });
  // Trailing row: render at the target height, left-aligned, never stretched.
  if (pending.length) {
    const h = (containerWidth - gap * (pending.length - 1)) / aspectSum;
    flush(Math.min(h, targetRowHeight));
  }

  return rows;
}
