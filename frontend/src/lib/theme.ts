// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

export type AdminTheme = "light" | "dark";

// localStorage keys are mirrored by the inline pre-hydration script in app/layout.tsx —
// keep them in sync if renamed.
export const THEME_STORAGE_KEY = "cs-admin-theme";
export const ACCENT_STORAGE_KEY = "cs-admin-accent";
export const ACCENT_FG_STORAGE_KEY = "cs-admin-accent-fg";
export const ACCENT_GRADIENT_STORAGE_KEY = "cs-admin-accent-gradient";

/** Pick a readable text color (near-black or near-white) for the given accent hex. */
export function accentForeground(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = h.slice(0, 3).split("").map((c) => c + c).join("");
  }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "oklch(0.145 0 0)" : "oklch(0.985 0 0)";
}

/** Apply theme + accent (+ optional gradient) to the document and cache for the pre-hydration script. */
export function applyAdminTheme(theme: AdminTheme, accent: string, gradient = false) {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.classList.toggle("accent-gradient", gradient);
  const fg = accentForeground(accent);
  el.style.setProperty("--primary", accent);
  el.style.setProperty("--ring", accent);
  el.style.setProperty("--primary-foreground", fg);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    localStorage.setItem(ACCENT_FG_STORAGE_KEY, fg);
    localStorage.setItem(ACCENT_GRADIENT_STORAGE_KEY, gradient ? "1" : "0");
  } catch {
    // localStorage unavailable — theme still applies, only the FOUC cache is skipped
  }
}

/** Restore the default look (dark, stock accent) for non-admin surfaces. */
export function resetAdminTheme() {
  const el = document.documentElement;
  el.classList.add("dark");
  el.classList.remove("accent-gradient");
  el.style.removeProperty("--primary");
  el.style.removeProperty("--ring");
  el.style.removeProperty("--primary-foreground");
}
