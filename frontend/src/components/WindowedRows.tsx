// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Window-virtualize a list of pre-chunked rows. Only on-screen rows (plus overscan) mount. Heights
// are measured from the DOM (`measureElement`) so per-row variation — filename captions,
// natural-aspect list tiles, sub-pixel rounding — is handled exactly; `estimateSize` is only the
// initial guess. Each row is expected to include its own top gap, so the measured height covers the
// inter-row spacing.
//
// The list virtualizes against whichever element actually scrolls: the public gallery scrolls the
// *window* (`min-h-screen` page), while the admin shell is `h-dvh overflow-hidden` with an inner
// `<main className="overflow-y-auto">` doing the scrolling. We detect the nearest scrollable
// ancestor on mount and pick the matching virtualizer — using the window virtualizer when the page
// itself scrolls (no overflow ancestor) and the element virtualizer otherwise. Getting this wrong
// silently breaks scrolling: a window virtualizer over an inner scroller never sees the scroll, so
// only the first viewport of rows ever mounts and the rest of the grid renders blank.
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";

interface RowsProps {
  count: number;
  estimateSize: (index: number) => number;
  renderRow: (index: number) => ReactNode;
  overscan?: number;
}

/** Nearest ancestor that scrolls vertically, or null when the window itself is the scroller. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
    node = node.parentElement;
  }
  return null;
}

export function WindowedRows(props: RowsProps) {
  const probeRef = useRef<HTMLDivElement>(null);
  // undefined while we measure; then the resolved scroll root (an element, or null = window).
  const [scrollParent, setScrollParent] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    setScrollParent(findScrollParent(probeRef.current));
  }, []);

  if (scrollParent === undefined) return <div ref={probeRef} />;
  return scrollParent
    ? <ElementVirtualizedRows {...props} scrollParent={scrollParent} />
    : <WindowVirtualizedRows {...props} />;
}

function PositionedRows({
  renderRow,
  totalSize,
  scrollMargin,
  virtualItems,
  measureElement,
  listRef,
}: {
  renderRow: (index: number) => ReactNode;
  totalSize: number;
  scrollMargin: number;
  virtualItems: { key: React.Key; index: number; start: number }[];
  measureElement: (el: Element | null) => void;
  listRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={listRef} style={{ height: totalSize, position: "relative" }}>
      {virtualItems.map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${vi.start - scrollMargin}px)`,
          }}
        >
          {renderRow(vi.index)}
        </div>
      ))}
    </div>
  );
}

function WindowVirtualizedRows({ count, estimateSize, renderRow, overscan = 3 }: RowsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Offset of the list from the document top, so window scroll coordinates map onto our rows.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const virtualizer = useWindowVirtualizer({ count, estimateSize, overscan, scrollMargin });

  return (
    <PositionedRows
      renderRow={renderRow}
      totalSize={virtualizer.getTotalSize()}
      scrollMargin={virtualizer.options.scrollMargin}
      virtualItems={virtualizer.getVirtualItems()}
      measureElement={virtualizer.measureElement}
      listRef={listRef}
    />
  );
}

function ElementVirtualizedRows({
  count, estimateSize, renderRow, overscan = 3, scrollParent,
}: RowsProps & { scrollParent: HTMLElement }) {
  const listRef = useRef<HTMLDivElement>(null);
  // Offset of the list from the top of the scroll container's content, so the container's scroll
  // coordinates map onto our rows (the list may sit below a toolbar / header inside the scroller).
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () =>
      setScrollMargin(el.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [scrollParent]);

  // eslint-disable-next-line react-hooks/incompatible-library -- same TanStack Virtual API as the window path; its functions are used directly here, not passed into memoized children.
  const virtualizer = useVirtualizer({
    count,
    estimateSize,
    overscan,
    scrollMargin,
    getScrollElement: () => scrollParent,
  });

  return (
    <PositionedRows
      renderRow={renderRow}
      totalSize={virtualizer.getTotalSize()}
      scrollMargin={virtualizer.options.scrollMargin}
      virtualItems={virtualizer.getVirtualItems()}
      measureElement={virtualizer.measureElement}
      listRef={listRef}
    />
  );
}
