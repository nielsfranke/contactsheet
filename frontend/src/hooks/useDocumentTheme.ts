// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useSyncExternalStore } from "react";

/**
 * Reads the *actual* light/dark theme off the document — the `dark` class the app toggles on
 * <html> (admin follows the instance setting; public `/g/*` is always dark). This is the single
 * source of truth: the app deliberately does **not** mount next-themes, so anything that needs to
 * know the theme (e.g. the sonner Toaster) must read the class, not `useTheme()`.
 */
function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useDocumentTheme(): "light" | "dark" {
  // Server render: default to dark (the root <html> ships with `dark`; admin un-sets it client-side).
  return useSyncExternalStore(subscribe, getSnapshot, () => "dark");
}
