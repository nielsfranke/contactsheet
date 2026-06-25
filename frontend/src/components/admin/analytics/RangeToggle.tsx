// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";

const RANGES = [7, 30, 90] as const;

interface Props {
  value: number;
  onChange: (days: number) => void;
}

export function RangeToggle({ value, onChange }: Props) {
  const t = useTranslations("admin.analytics");
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {RANGES.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            value === d
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("rangeDays", { days: d })}
        </button>
      ))}
    </div>
  );
}
