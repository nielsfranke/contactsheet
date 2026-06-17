// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from "@/lib/utils";

/**
 * Cover stand-in for a gallery with no photo (and no uploaded cover) — i.e. an empty gallery.
 * Instead of a generic icon, render the gallery name on a soft tint so the card still reads as a
 * deliberate, on-brand tile. Built on semantic tokens, so it adapts to the admin theme and the
 * public `.gallery-scope` (light/dark) automatically. `--muted` and `--accent` resolve to the same
 * value in this design, so the gradient runs `muted → muted-foreground/10` to stay visible.
 */
export function CoverPlaceholder({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10 px-4",
        className,
      )}
    >
      <span className="line-clamp-3 text-center text-base font-semibold tracking-tight text-foreground/55">
        {name}
      </span>
    </div>
  );
}
