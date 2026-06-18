// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder for the admin settings pages. Mirrors their shared shell
 * (`p-6 max-w-xl space-y-6` → header row + bordered section cards with label/field
 * rows) so the layout doesn't jump when the real form swaps in.
 */
export function SettingsPageSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="p-6 max-w-xl space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      {Array.from({ length: sections }).map((_, i) => (
        <section key={i} className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-full" />
          </div>
        </section>
      ))}
    </div>
  );
}
