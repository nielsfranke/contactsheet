// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

export type AdminTheme = "light" | "dark";

// localStorage keys are mirrored by the inline pre-hydration script in app/layout.tsx —
// keep them in sync if renamed.
export const THEME_STORAGE_KEY = "cs-admin-theme";
export const ACCENT_STORAGE_KEY = "cs-admin-accent";
export const ACCENT_FG_STORAGE_KEY = "cs-admin-accent-fg";
export const ACCENT_GRADIENT_STORAGE_KEY = "cs-admin-accent-gradient";

/** WCAG relative luminance of a #rgb / #rrggbb hex. */
function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = h.slice(0, 3).split("").map((c) => c + c).join("");
  }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick a readable text color (near-black or near-white) for the given accent hex. */
export function accentForeground(hex: string): string {
  return luminance(hex) > 0.45 ? "oklch(0.145 0 0)" : "oklch(0.985 0 0)";
}

// The admin page backgrounds (globals.css `--background`: oklch(1 0 0) / oklch(0.145 0 0)).
const THEME_BACKGROUND_LUMINANCE: Record<AdminTheme, number> = { light: 1, dark: 0.0030 };

/**
 * Whether `accent` can carry buttons, links and focus rings on this theme's background — WCAG 1.4.11
 * (non-text contrast ≥ 3:1). One stored accent has to work on paper white *and* near black: the
 * default black accent vanishes on the dark theme, a very light one on the light theme. When this is
 * false, `applyAdminTheme` keeps the theme's own primary + ring for that theme instead.
 */
export function accentUsableOn(accent: string, theme: AdminTheme): boolean {
  const a = luminance(accent);
  const bg = THEME_BACKGROUND_LUMINANCE[theme];
  const [hi, lo] = a > bg ? [a, bg] : [bg, a];
  return (hi + 0.05) / (lo + 0.05) >= 3;
}

/** Apply theme + accent (+ optional gradient) to the document and cache for the pre-hydration script. */
export function applyAdminTheme(theme: AdminTheme, accent: string, gradient = false) {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.classList.toggle("accent-gradient", gradient);
  // An accent without enough contrast on this theme falls back to the theme's own primary/ring
  // (globals.css) — never a black button on a near-black page or an invisible focus ring.
  const usable = accentUsableOn(accent, theme);
  const fg = accentForeground(accent);
  if (usable) {
    el.style.setProperty("--primary", accent);
    el.style.setProperty("--ring", accent);
    el.style.setProperty("--primary-foreground", fg);
  } else {
    el.style.removeProperty("--primary");
    el.style.removeProperty("--ring");
    el.style.removeProperty("--primary-foreground");
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    // The pre-hydration script applies whatever is cached here: cache nothing for an unusable
    // accent so the first paint already uses the theme default.
    if (usable) {
      localStorage.setItem(ACCENT_STORAGE_KEY, accent);
      localStorage.setItem(ACCENT_FG_STORAGE_KEY, fg);
    } else {
      localStorage.removeItem(ACCENT_STORAGE_KEY);
      localStorage.removeItem(ACCENT_FG_STORAGE_KEY);
    }
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
