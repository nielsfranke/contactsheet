// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True when the primary pointer is coarse (touch). Used to disable gallery reparent drag on touch —
 * a long-press-then-drag there is fiddly and easy to trigger by accident while scrolling, and the
 * "Move gallery" dialog already covers reparenting on touch.
 *
 * `useSyncExternalStore` keeps this SSR-safe (server snapshot is `false`, so the draggable affordance
 * renders, then hydrates to the real value) without setting state inside an effect.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
