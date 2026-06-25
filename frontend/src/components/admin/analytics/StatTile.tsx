// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";

interface Props {
  label: string;
  value: number | string;
  icon?: ReactNode;
  /** Dimmed presentation for unavailable metrics (e.g. views when IP logging is off). */
  muted?: boolean;
}

export function StatTile({ label, value, icon, muted = false }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? "text-muted-foreground/50" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
