// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small "clear" affordance inside a filter/search input — an X at the right edge that wipes the
 * field. Render it (conditionally, when there's text) as the last child of the input's `relative`
 * wrapper. Shared so every filter box clears the same way.
 */
export function InputClearButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <X size={14} />
    </button>
  );
}
