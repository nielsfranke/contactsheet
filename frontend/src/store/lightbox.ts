// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import type { ImageResponse } from "@/lib/types";

/** What the lightbox should reveal on open, when a click expresses intent (e.g. the comment badge
 *  opens straight to comments). The lightbox mounts fresh on open, so it seeds its panel state from
 *  this. */
export interface LightboxIntent {
  panel?: "comments" | "annotations";
}

interface LightboxState {
  isOpen: boolean;
  images: ImageResponse[];
  currentIndex: number;
  intent: LightboxIntent;
  open: (images: ImageResponse[], index: number, intent?: LightboxIntent) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

export const useLightboxStore = create<LightboxState>((set, get) => ({
  isOpen: false,
  images: [],
  currentIndex: 0,
  intent: {},
  open: (images, index, intent = {}) =>
    set({ isOpen: true, images, currentIndex: index, intent }),
  close: () => set({ isOpen: false }),
  next: () => {
    const { images, currentIndex } = get();
    set({ currentIndex: (currentIndex + 1) % images.length });
  },
  prev: () => {
    const { images, currentIndex } = get();
    set({ currentIndex: (currentIndex - 1 + images.length) % images.length });
  },
  // Jump straight to an index (no wrap) — used by the mobile scroll-snap carousel, which reports
  // the settled slide. Clamped to range so a stray scroll value can't desync.
  goTo: (index: number) => {
    const { images, currentIndex } = get();
    if (index >= 0 && index < images.length && index !== currentIndex) {
      set({ currentIndex: index });
    }
  },
}));
