// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Window-virtualize a list of pre-chunked rows against the *page* scroll (the gallery scrolls the
// window, not an inner box). Only on-screen rows (plus overscan) mount. Heights are measured from
// the DOM (`measureElement`) so per-row variation — filename captions, natural-aspect list tiles,
// sub-pixel rounding — is handled exactly; `estimateSize` is only the initial guess. Each row is
// expected to include its own top gap, so the measured height covers the inter-row spacing.
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

export function WindowedRows({
  count,
  estimateSize,
  renderRow,
  overscan = 3,
}: {
  count: number;
  estimateSize: (index: number) => number;
  renderRow: (index: number) => ReactNode;
  overscan?: number;
}) {
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
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)`,
          }}
        >
          {renderRow(vi.index)}
        </div>
      ))}
    </div>
  );
}
