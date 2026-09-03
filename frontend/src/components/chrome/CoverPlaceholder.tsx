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
export function CoverPlaceholder({ name, className, compact = false }: { name: string; className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10",
        compact ? "px-1" : "px-4",
        className,
      )}
      title={compact ? name : undefined}
    >
      {compact ? (
        // A thumbnail-sized tile (list rows) has no room for the name — a monogram stands in.
        <span className="text-sm font-semibold tracking-tight text-foreground/55" aria-hidden>
          {monogram(name)}
        </span>
      ) : (
        <span className="line-clamp-3 text-center text-base font-semibold tracking-tight text-foreground/55">
          {name}
        </span>
      )}
    </div>
  );
}

/** First letter of the first two words, e.g. "Familie Müller 2026" → "FM". */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => Array.from(w)[0]?.toUpperCase() ?? "").join("");
}
