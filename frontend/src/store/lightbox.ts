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
  /** Replace the slide list with fresh data (React Query refetch / WS invalidation) while open,
   *  keeping the current slide by id. Without this the lightbox works on the snapshot taken at
   *  open() and flags/likes/counts visually revert when navigating back to an edited slide. */
  syncImages: (images: ImageResponse[]) => void;
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
  syncImages: (images) => {
    const { isOpen, images: prev, currentIndex } = get();
    if (!isOpen) return;
    if (images.length === 0) {
      set({ isOpen: false });
      return;
    }
    // Callers re-derive their list every render; only item identities matter (they change when
    // React Query refetches). Bail on identical content so this can run unconditionally.
    if (images.length === prev.length && images.every((img, i) => img === prev[i])) return;
    const current = prev[currentIndex];
    const nextIndex = current ? images.findIndex((i) => i.id === current.id) : -1;
    set({
      images,
      // Current slide deleted/filtered out → clamp instead of wrapping to a random photo.
      currentIndex: nextIndex >= 0 ? nextIndex : Math.min(currentIndex, images.length - 1),
    });
  },
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
