// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  GALLERY_FONT_GROUPS,
  openerFontLabel,
  resolveOpenerFont,
  type GalleryFont,
} from "@/lib/gallery-fonts";

/**
 * Categorized opener-font picker: a select-like trigger that opens a grouped,
 * scrollable list with each option previewed in its own face. Fonts are declared globally in
 * layout.tsx, so previews render accurately. Self-contained popover — no Radix dependency.
 */
export function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = resolveOpenerFont(value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-56 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
      >
        <span
          className="truncate"
          style={{ fontFamily: current.fontFamily, fontWeight: current.fontWeight }}
        >
          {openerFontLabel(value)}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {GALLERY_FONT_GROUPS.map((group) => (
            <div key={group.id} className="mb-1 last:mb-0">
              <div className="flex items-baseline gap-1.5 px-2 pb-1 pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  {group.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{group.note}</span>
              </div>
              {group.fonts.map((font) => (
                <FontOption
                  key={font.key}
                  font={font}
                  selected={font.key === value}
                  onSelect={() => {
                    onChange(font.key);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FontOption({
  font,
  selected,
  onSelect,
}: {
  font: GalleryFont;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-accent" : "hover:bg-accent/60"
      }`}
    >
      <Check size={14} className={`shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
      <span
        className="truncate text-base leading-tight"
        style={{ fontFamily: `var(${font.cssVar})`, fontWeight: font.headingWeight }}
      >
        {font.label}
      </span>
    </button>
  );
}
