// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ColorFlag } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { ToolbarBand } from "@/components/gallery/ToolbarBand";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { Search, Ban, MessageCircle, ArrowDownUp, X, SlidersHorizontal } from "lucide-react";

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
 *
 * Responsive split: at sm+ every control sits inline in one band. On a phone the band would wrap
 * to three sticky rows, so below sm only the filename search + a "Filter & sort" trigger stay in
 * the band; the flag/comment filters, sort and grouping move into an on-demand bottom sheet. The
 * sheet renders inline (no portal) so it inherits the surrounding `.gallery-scope` tone.
 */
export function GalleryToolbar({
  arrange, setArrange, shownCount, totalCount,
  features = { colorFlags: true, comments: true }, captureSortAvailable = true, className,
}: Props) {
  const t = useTranslations("gallery.toolbar");
  const tf = useTranslations("gallery.flags");
  const tc = useTranslations("common");
  const [sheetOpen, setSheetOpen] = useState(false);

  const filterActive =
    arrange.filterName.trim() !== "" || arrange.flagFilters.size > 0 || arrange.commentsOnly;
  // Drives the trigger badge — only the controls that now live in the sheet count (the filename
  // search keeps its own inline clear button).
  const sheetFilterCount = arrange.flagFilters.size + (arrange.commentsOnly ? 1 : 0);

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

  // Shared control renderers — used inline (desktop) and inside the bottom sheet (mobile), so the
  // wiring lives in one place and only the surrounding layout differs.
  const flagChips = (sizeCls: string) =>
    FLAG_CHIPS.map((c) => {
      const active = arrange.flagFilters.has(c.value);
      return (
        <button
          key={c.value}
          onClick={() => toggleFlag(c.value)}
          title={tf(c.value)}
          aria-label={tf(c.value)}
          aria-pressed={active}
          className={`${sizeCls} rounded-full flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${c.bg} ${
            active ? "ring-2 ring-foreground/50 scale-110" : "opacity-40 hover:opacity-80"
          }`}
        >
          {c.value === "none" && <Ban size={11} className="text-background" />}
        </button>
      );
    });

  const sortSelect = (cls: string) => (
    <select
      value={sortValue}
      onChange={(e) => setArrange({ ...arrange, sortKey: e.target.value as ToolbarSortKey })}
      className={cls}
      aria-label={t("sortBy")}
    >
      {sortKeys.map((k) => <option key={k} value={k}>{t(`sort.${k}`)}</option>)}
    </select>
  );

  const sortDirButton = (cls: string) => (
    <button
      onClick={() => setArrange({ ...arrange, sortAsc: !arrange.sortAsc })}
      title={arrange.sortAsc ? t("ascending") : t("descending")}
      aria-label={arrange.sortAsc ? t("ascending") : t("descending")}
      className={`${cls} shrink-0 flex items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <ArrowDownUp size={14} />
    </button>
  );

  const groupSelect = (cls: string) => (
    <select
      value={arrange.groupKey}
      onChange={(e) => setArrange({ ...arrange, groupKey: e.target.value as ToolbarGroupKey })}
      className={cls}
      aria-label={t("groupBy")}
    >
      {GROUP_KEYS.map((k) => <option key={k} value={k}>{t(`group.${k}`)}</option>)}
    </select>
  );

  return (
    <>
    <ToolbarBand className={className}>
      {/* Filter by filename. On a phone it flexes to share the band's single row with the Filter
          trigger; at sm+ it returns to a fixed width sized for the longest placeholder. Right
          padding is only reserved when the clear button is actually shown. */}
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

      {/* Mobile-only trigger — opens the bottom sheet with the flag/comment/sort/group controls. */}
      <button
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        className="sm:hidden inline-flex items-center gap-1.5 h-8 shrink-0 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlidersHorizontal size={14} />
        {t("filterSort")}
        {sheetFilterCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
            {sheetFilterCount}
          </span>
        )}
      </button>

      {/* ── Desktop inline controls (sm+) ───────────────────────────────────────────────────── */}

      {/* Flag chips + comments */}
      {(features.colorFlags || features.comments) && (
        <div className="hidden sm:flex items-center gap-1.5">
          {features.colorFlags && flagChips("w-5 h-5")}
          {features.comments && (
            <button
              onClick={() => setArrange({ ...arrange, commentsOnly: !arrange.commentsOnly })}
              title={t("hasComments")}
              aria-label={t("hasComments")}
              aria-pressed={arrange.commentsOnly}
              className={`ml-1 p-1 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                arrange.commentsOnly ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageCircle size={14} />
            </button>
          )}
        </div>
      )}

      {/* Sort + group — pushed right on wide screens. */}
      <div className="hidden sm:flex flex-wrap items-center gap-2 sm:ml-auto">
        {sortSelect(selectCls)}
        {sortDirButton("h-8 w-8")}
        {features.colorFlags && groupSelect(selectCls)}
      </div>

      {/* Result count + clear (only while filtering) */}
      {filterActive && (
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
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

    {/* ── Mobile bottom sheet (below sm) — sibling of the band so `position: fixed` is anchored to
        the viewport, not the band (its `backdrop-blur` would otherwise become the containing block
        and pin the sheet to the 1-row band). It still sits inside `.gallery-scope`, so the public
        gallery tone applies. */}
    {sheetOpen && (
        <div className="sm:hidden">
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("filterSort")}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{t("filterSort")}</h2>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label={t("done")}
                className="p-1 -m-1 rounded text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={18} />
              </button>
            </div>

            {features.colorFlags && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t("flagsLabel")}</p>
                <div className="flex items-center gap-3">{flagChips("w-8 h-8")}</div>
              </div>
            )}

            {features.comments && (
              <button
                onClick={() => setArrange({ ...arrange, commentsOnly: !arrange.commentsOnly })}
                aria-pressed={arrange.commentsOnly}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 h-11 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  arrange.commentsOnly
                    ? "border-primary text-primary bg-primary/10"
                    : "border-input text-foreground hover:bg-accent"
                }`}
              >
                <MessageCircle size={16} /> {t("hasComments")}
              </button>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("sortBy")}</p>
              <div className="flex items-center gap-2">
                {sortSelect(`${selectCls} h-11 flex-1`)}
                {sortDirButton("h-11 w-11")}
              </div>
            </div>

            {features.colorFlags && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t("groupBy")}</p>
                {groupSelect(`${selectCls} h-11 w-full`)}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              {filterActive ? (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg px-2 h-11 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={14} /> {t("clearFilters")}
                  <span className="ml-1 tabular-nums opacity-70">
                    {t("resultCount", { shown: shownCount, total: totalCount })}
                  </span>
                </button>
              ) : <span />}
              <button
                onClick={() => setSheetOpen(false)}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-5 h-11 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("done")}
              </button>
            </div>
          </div>
        </div>
    )}
    </>
  );
}
