// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import type { ModeType } from "@/lib/types";

/**
 * Display names for the two gallery modes (internal `collaboration` / `presentation` → "Review" /
 * "Showcase" in English). Translatable like every other UI string — the community locales name the
 * modes themselves. The enum values never change.
 */
export function useModeLabels(): Record<ModeType, string> {
  const t = useTranslations("common.modes");
  return { collaboration: t("collaboration"), presentation: t("presentation") };
}
