// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from "@/lib/utils"

/**
 * Loading placeholder. Pure Tailwind (no new deps): `animate-pulse` on the
 * `muted` token so it tracks light/dark. Honors `prefers-reduced-motion`
 * globally (globals.css reduces animation-duration). Use it to reserve the
 * shape of async content instead of a bare "loading…" line, which jumps.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
