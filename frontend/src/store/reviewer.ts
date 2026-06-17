// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ReviewerState {
  name: string | null;
  setName: (name: string) => void;
  clear: () => void;
}

export const useReviewerStore = create<ReviewerState>()(
  persist(
    (set) => ({
      name: null,
      setName: (name) => set({ name: name.trim() || null }),
      clear: () => set({ name: null }),
    }),
    {
      name: "contactsheet-reviewer",
    }
  )
);
