// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import type { ColorFlag } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { ToolbarBand } from "@/components/gallery/ToolbarBand";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { Search, Ban, MessageCircle, ArrowDownUp, X } from "lucide-react";

export type ToolbarSortKey = "manual" | "filename" | "date" | "captured";
export type ToolbarGroupKey = "none" | "flag";

export interface ToolbarArrange {
  filterName: string;
  flagFilters: Set<ColorFlag>;
  commentsOnly: boolean;
  sortKey: ToolbarSortKey;
  sortAsc: boolean;
  groupKey: ToolbarGroupKey;
}

/** Which collaboration controls to surface. The admin shows them all; the client gates them on
 *  its per-gallery feature toggles. */
export interface ToolbarFeatures {
  colorFlags: boolean;
  comments: boolean;
}

const FLAG_CHIPS: { value: ColorFlag; bg: string }[] = [
  { value: "none",   bg: "bg-muted-foreground/40" },
  { value: "red",    bg: "bg-red-500" },
  { value: "yellow", bg: "bg-yellow-400" },
  { value: "green",  bg: "bg-green-500" },
  { value: "blue",   bg: "bg-blue-400" },
];

const SORT_KEYS: ToolbarSortKey[] = ["manual", "filename", "date", "captured"];
const GROUP_KEYS: ToolbarGroupKey[] = ["none", "flag"];

interface Props {
  arrange: ToolbarArrange;
  setArrange: (next: ToolbarArrange) => void;
  shownCount: number;
  totalCount: number;
  /** Collaboration controls to show. Defaults to all (admin). */
  features?: ToolbarFeatures;
  /** Whether to offer the "Capture Date" sort — only when at least one photo has EXIF capture
   *  metadata. Defaults to true. */
  captureSortAvailable?: boolean;
  /** Positioning + padding for the bar; differs by host layout (admin bleeds into page padding,
   *  the client sits inside its own sticky container). Colors/geometry live here. */
  className?: string;
}

/**
 * View controls (filter / sort / group) shown above a gallery photo grid. Single source of truth
 * for both the admin in-gallery view and the public client gallery — it is styled entirely with
 * semantic theme tokens, so it renders against the admin theme on `/admin` and against the
 * per-gallery tone inside a `.gallery-scope` on the public page, with no duplicated palettes.
 */
export function GalleryToolbar({
  arrange, setArrange, shownCount, totalCount,
  features = { colorFlags: true, comments: true }, captureSortAvailable = true, className,
}: Props) {
  const t = useTranslations("gallery.toolbar");
  const tf = useTranslations("gallery.flags");
  const tc = useTranslations("common");
  const filterActive =
    arrange.filterName.trim() !== "" || arrange.flagFilters.size > 0 || arrange.commentsOnly;

  function toggleFlag(f: ColorFlag) {
    const next = new Set(arrange.flagFilters);
    if (next.has(f)) next.delete(f); else next.add(f);
    setArrange({ ...arrange, flagFilters: next });
  }

  function clearFilters() {
    setArrange({ ...arrange, filterName: "", flagFilters: new Set(), commentsOnly: false });
  }

  const selectCls = "h-8 max-w-full text-sm bg-background border border-input text-foreground rounded-lg px-2";

  // Drop "Capture Date" when no photo carries the metadata. If it was the active sort, fall back
  // to filename in the select (the grid does the same), so the control never renders blank.
  const sortKeys = captureSortAvailable ? SORT_KEYS : SORT_KEYS.filter((k) => k !== "captured");
  const sortValue = sortKeys.includes(arrange.sortKey) ? arrange.sortKey : "filename";

  return (
    <ToolbarBand className={className}>
      {/* Filter by filename. On a phone it flexes to share the first row with the flag chips; at
          sm+ it returns to a fixed width sized for the longest placeholder (DE "Nach Dateiname
          filtern"). Right padding is only reserved when the clear button is actually shown. */}
      <div className="relative flex-1 min-w-0 sm:flex-none sm:w-56">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={arrange.filterName}
          onChange={(e) => setArrange({ ...arrange, filterName: e.target.value })}
          placeholder={t("filterPlaceholder")}
          className={`pl-8 h-8 text-sm w-full ${arrange.filterName ? "pr-8" : "pr-3"}`}
        />
        {arrange.filterName && (
          <InputClearButton onClick={() => setArrange({ ...arrange, filterName: "" })} label={tc("clear")} />
        )}
      </div>

      {/* Flag chips + comments */}
      {(features.colorFlags || features.comments) && (
        <div className="flex items-center gap-1.5">
          {features.colorFlags && FLAG_CHIPS.map((c) => {
            const active = arrange.flagFilters.has(c.value);
            return (
              <button
                key={c.value}
                onClick={() => toggleFlag(c.value)}
                title={tf(c.value)}
                aria-label={tf(c.value)}
                aria-pressed={active}
                className={`w-6 h-6 sm:w-5 sm:h-5 rounded-full flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${c.bg} ${
                  active ? "ring-2 ring-foreground/50 scale-110" : "opacity-40 hover:opacity-80"
                }`}
              >
                {c.value === "none" && <Ban size={11} className="text-background" />}
              </button>
            );
          })}
          {features.comments && (
            <button
              onClick={() => setArrange({ ...arrange, commentsOnly: !arrange.commentsOnly })}
              title={t("hasComments")}
              aria-label={t("hasComments")}
              aria-pressed={arrange.commentsOnly}
              className={`ml-1 p-1.5 sm:p-1 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                arrange.commentsOnly ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageCircle size={14} />
            </button>
          )}
        </div>
      )}

      {/* Sort + group — pushed right on wide screens, wraps below on narrow. `flex-wrap` +
          `min-w-0` selects keep the (long, e.g. DE "Nach Markierung gruppieren") group dropdown
          from spilling past a phone's right edge. */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <select
          value={sortValue}
          onChange={(e) => setArrange({ ...arrange, sortKey: e.target.value as ToolbarSortKey })}
          className={selectCls}
          aria-label={t("sortBy")}
        >
          {sortKeys.map((k) => <option key={k} value={k}>{t(`sort.${k}`)}</option>)}
        </select>
        <button
          onClick={() => setArrange({ ...arrange, sortAsc: !arrange.sortAsc })}
          title={arrange.sortAsc ? t("ascending") : t("descending")}
          aria-label={arrange.sortAsc ? t("ascending") : t("descending")}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDownUp size={14} />
        </button>
        {features.colorFlags && (
          <select
            value={arrange.groupKey}
            onChange={(e) => setArrange({ ...arrange, groupKey: e.target.value as ToolbarGroupKey })}
            className={selectCls}
            aria-label={t("groupBy")}
          >
            {GROUP_KEYS.map((k) => <option key={k} value={k}>{t(`group.${k}`)}</option>)}
          </select>
        )}
      </div>

      {/* Result count + clear (only while filtering) */}
      {filterActive && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{t("resultCount", { shown: shownCount, total: totalCount })}</span>
          <button
            onClick={clearFilters}
            title={t("clearFilters")}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors hover:text-foreground hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={12} /> {t("clear")}
          </button>
        </div>
      )}
    </ToolbarBand>
  );
}
