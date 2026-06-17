// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Multi-select state for a gallery's image grid (collections). A "Select" mode you toggle on;
 * while on, tiles are selectable: click toggles, shift-click selects the range from the anchor,
 * Ctrl/Cmd+A selects all currently-visible (filtered) images. Escape clears the current
 * selection, or exits selection mode when nothing is selected.
 *
 * `visibleIds` is the ordered list of ids currently shown (after filter/sort) — it drives range
 * selection and select-all.
 */
export function useImageSelection(visibleIds: string[]) {
  const [mode, setModeState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const clear = useCallback(() => setSelected(new Set()), []);

  const setMode = useCallback((on: boolean) => {
    setModeState(on);
    if (!on) {
      setSelected(new Set());
      anchorRef.current = null;
    }
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const selectRange = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const anchor = anchorRef.current;
        const next = new Set(prev);
        const a = anchor ? visibleIds.indexOf(anchor) : -1;
        const b = visibleIds.indexOf(id);
        if (a === -1 || b === -1) {
          next.add(id);
          return next;
        }
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(visibleIds[i]);
        return next;
      });
      // Keep the original anchor so the range can be re-adjusted with another shift-click.
    },
    [visibleIds],
  );

  const selectAll = useCallback(() => setSelected(new Set(visibleIds)), [visibleIds]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  useEffect(() => {
    if (!mode) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(visibleIds));
      } else if (e.key === "Escape") {
        // Clear the current selection first; a second Escape exits selection mode entirely.
        if (selected.size > 0) setSelected(new Set());
        else setMode(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, visibleIds, selected, setMode]);

  return { mode, setMode, selected, isSelected, toggle, selectRange, selectAll, clear, count: selected.size };
}
