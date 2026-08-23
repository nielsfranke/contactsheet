// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Why the Views column shows "—": `viewed` activity rows exist only while IP logging is on
 * (Settings → General). Shown wherever `views_available` is false, so a dimmed metric always
 * explains itself instead of reading as zero traffic.
 */
export function ViewsDisabledNote() {
  const t = useTranslations("admin.analytics");
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info size={14} className="mt-0.5 flex-shrink-0" />
      <span>
        {t("viewsDisabled")}{" "}
        <Link href="/admin/settings/general" className="underline hover:text-foreground">
          {t("viewsDisabledLink")}
        </Link>
      </span>
    </div>
  );
}
