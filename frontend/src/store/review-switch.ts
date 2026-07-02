// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Client-side "switched to Review" state for Showcase galleries that opted into the client mode
 * switch (`client_mode_switch_enabled`). Keyed per visible subtree (the topmost breadcrumb
 * ancestor's share token, or the gallery's own), so the choice survives navigating between a
 * gallery and its sub-galleries but never leaks across unrelated galleries. sessionStorage-backed:
 * a fresh visit always starts in Showcase.
 */
interface ReviewSwitchState {
  switched: Record<string, boolean>;
  setSwitched: (key: string, on: boolean) => void;
}

export const useReviewSwitchStore = create<ReviewSwitchState>()(
  persist(
    (set) => ({
      switched: {},
      setSwitched: (key, on) =>
        set((s) => ({ switched: { ...s.switched, [key]: on } })),
    }),
    {
      name: "contactsheet-review-switch",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
