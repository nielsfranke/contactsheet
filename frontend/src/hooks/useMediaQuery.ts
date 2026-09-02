// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useSyncExternalStore } from "react";

/** SSR-safe `matchMedia` subscription (server snapshot: false). Same pattern as useCoarsePointer. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md` breakpoint — where the sidebars become off-canvas drawers. */
export function useBelowMd(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
