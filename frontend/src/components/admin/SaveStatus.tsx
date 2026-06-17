// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import { Check, Loader2, AlertCircle } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/useSettingsAutosave";

/**
 * Subtle auto-save indicator for the settings pages (replaces the old Save button). Keeps a fixed
 * height so the layout doesn't jump as the status changes.
 */
export function SaveStatus({ status }: { status: AutosaveStatus }) {
  const tc = useTranslations("common");
  const t = useTranslations("settings");
  return (
    <div className="flex h-5 items-center text-xs" aria-live="polite">
      {status === "saving" && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> {tc("saving")}
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Check size={13} className="text-emerald-500" /> {t("savedShort")}
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1.5 text-destructive">
          <AlertCircle size={13} /> {t("saveError")}
        </span>
      )}
    </div>
  );
}
