// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { OVERLAY_REST, OVERLAY_HOVER, BADGE_BG } from "@/lib/ui-tokens";

/**
 * The translucent-black chrome drawn over photos — the single definition of the on-tile pill that
 * used to be hand-rolled (with drifting opacity/size/padding) in PhotoGrid, admin-grid-tile, and
 * overview-parts.
 *
 * - `variant="control"` — an interactive button/link (download, like, kebab, pin, open). Hover-darkens.
 * - `variant="badge"`   — a read-only count/info chip. Not interactive (pointer-events-none).
 *
 * Polymorphic via `as` ("span" default, "button", or "a"); extra props are forwarded to that element.
 */
const overlayPillVariants = cva("inline-flex items-center transition-colors", {
  variants: {
    variant: {
      control: cn(OVERLAY_REST, OVERLAY_HOVER, "text-white"),
      badge: cn(BADGE_BG, "text-zinc-200 pointer-events-none"),
    },
    size: {
      // Read-only count chips (formerly 9–10px icon, text-[10px]).
      xs: "gap-0.5 px-1.5 py-0.5 text-[10px]",
      // Interactive controls (formerly h-7 px-2, text-[11px]).
      sm: "h-7 px-2 gap-1 text-[11px]",
    },
    shape: {
      rounded: "rounded",
      pill: "rounded-full",
      // Square icon-only button (kebab) — pair with size="sm" for h-7 w-7.
      iconPill: "rounded-full justify-center w-7 h-7 px-0",
      // Centered media badge (video play) — caller sets explicit w/h via className.
      circle: "rounded-full justify-center",
    },
  },
  defaultVariants: { variant: "badge", size: "xs", shape: "rounded" },
});

type OverlayPillProps<E extends "span" | "button" | "a"> = {
  as?: E;
  className?: string;
} & VariantProps<typeof overlayPillVariants> &
  Omit<React.ComponentPropsWithoutRef<E>, "className">;

export function OverlayPill<E extends "span" | "button" | "a" = "span">({
  as,
  variant,
  size,
  shape,
  className,
  ...props
}: OverlayPillProps<E>) {
  const Comp = (as ?? "span") as React.ElementType;
  return (
    <Comp className={cn(overlayPillVariants({ variant, size, shape }), className)} {...props} />
  );
}

export { overlayPillVariants };
