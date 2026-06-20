// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

/**
 * Per-route override for the admin shell's mobile top bar. A page (the gallery detail view) can set
 * a "go up" context here — a back chevron + label linking one level up — which the shell renders in
 * place of the global instance brand. This collapses the otherwise-stacked brand bar + in-page
 * up-nav into a single row on a phone. Desktop is unaffected (the bar is `md:hidden`).
 *
 * Plain data only (no JSX): the shell owns the markup so it stays styled with the shell's tokens.
 * Pages set it on mount and clear it on unmount.
 */
export interface AdminMobileHeaderNav {
  label: string;
  href: string;
}

interface AdminMobileHeaderState {
  nav: AdminMobileHeaderNav | null;
  setNav: (nav: AdminMobileHeaderNav | null) => void;
}

export const useAdminMobileHeader = create<AdminMobileHeaderState>((set) => ({
  nav: null,
  setNav: (nav) => set({ nav }),
}));
