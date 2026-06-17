// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Client-safe locale constants (no server-only imports), shared by the request config,
// the admin language picker, and shared types.

export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Cookie that pins the resolved locale (admin's choice / returning visitor). Read server-side in
// src/i18n/request.ts; written client-side by the admin language picker.
export const LOCALE_COOKIE = "NEXT_LOCALE";

// Native-name labels for the language picker.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
