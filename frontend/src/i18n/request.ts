// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale, type Locale } from "./locales";

/** Pick the best supported locale from an `Accept-Language` header. */
function negotiate(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const languages = new Negotiator({ headers: { "accept-language": acceptLanguage } }).languages();
  try {
    return match(languages, SUPPORTED_LOCALES as readonly string[], DEFAULT_LOCALE) as Locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// "Without i18n routing" mode: the locale never appears in the URL (share links stay stable).
// Resolution order: explicit cookie (admin's chosen language / returning visitor) → browser
// Accept-Language (first-time public visitors) → English.
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : negotiate((await headers()).get("accept-language"));

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
