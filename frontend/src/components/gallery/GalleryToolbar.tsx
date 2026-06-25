// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ColorFlag, RatingMode } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { ToolbarBand } from "@/components/gallery/ToolbarBand";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { Icons } from "@/lib/ui-icons";
import { Search, Ban, MessageCircle, ArrowDownUp, X, SlidersHorizontal, ScanSearch, Loader2 } from "lucide-react";

export type ToolbarSortKey = "manual" | "filename" | "date" | "captured" | "rating";
export type ToolbarGroupKey = "none" | "flag" | "rating";

export interface ToolbarArrange {
  filterName: string;
  flagFilters: Set<ColorFlag>;
  /** Stars mode: filter to photos with these exact ratings (0 = unrated). Parallel to flagFilters. */
  ratingFilters: Set<number>;
  commentsOnly: boolean;
  sortKey: ToolbarSortKey;
  sortAsc: boolean;
  groupKey: ToolbarGroupKey;
}

/** Optional semantic content-search (admin only). When provided, it becomes the toolbar's primary
 *  field and the filename filter is demoted into the Filter sheet — so "search" means search-by-
 *  content (the photographer's primary intent) and the two never share one ambiguous box. */
export interface ToolbarContentSearch {
  query: string;
  setQuery: (next: string) => void;
  loading: boolean;
  placeholder: string;
}

/** Which collaboration controls to surface. The admin shows them all; the client gates them on
 *  its per-gallery feature toggles. */
export interface ToolbarFeatures {
  colorFlags: boolean;
  comments: boolean;
  /** Rating style — chips/group/sort switch between flags and stars. Defaults to flags. */
  ratingMode?: RatingMode;
}

const FLAG_CHIPS: { value: ColorFlag; bg: string }[] = [
  { value: "none",   bg: "bg-muted-foreground/40" },
  { value: "red",    bg: "bg-red-500" },
  { value: "yellow", bg: "bg-yellow-400" },
  { value: "green",  bg: "bg-green-500" },
  { value: "blue",   bg: "bg-blue-400" },
];

// Rating filter chips: unrated (0) then 1–5.
const RATING_CHIPS: number[] = [0, 1, 2, 3, 4, 5];

const SORT_KEYS: ToolbarSortKey[] = ["manual", "filename", "date", "captured"];

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
  /** Admin-only semantic content search. When set, takes the primary slot and pushes the filename
   *  filter into the Filter sheet. Absent on the public gallery — that toolbar is unchanged. */
  search?: ToolbarContentSearch;
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
  features = { colorFlags: true, comments: true }, captureSortAvailable = true, className, search,
}: Props) {
  const t = useTranslations("gallery.toolbar");
  const tf = useTranslations("gallery.flags");
  const ts = useTranslations("gallery.stars");
  const tc = useTranslations("common");
  const [sheetOpen, setSheetOpen] = useState(false);
  const stars = features.ratingMode === "stars";

  // Content-search mode: the input is the primary field; while a query is active the filter/sort
  // controls step aside (results are a similarity ranking, not a client-side filter/sort).
  const searchMode = !!search;
  const searching = searchMode && search!.query.trim() !== "";

  // The active rating filter set drives chips/count in stars mode; flags use flagFilters.
  const ratingFilterCount = stars ? arrange.ratingFilters.size : arrange.flagFilters.size;
  const filterActive =
    arrange.filterName.trim() !== "" || ratingFilterCount > 0 || arrange.commentsOnly;
  // Drives the trigger badge — the controls that live in the sheet. In content-search mode the
  // filename filter lives there too, so it counts; otherwise it keeps its own inline clear button.
  const sheetFilterCount =
    ratingFilterCount + (arrange.commentsOnly ? 1 : 0) +
    (searchMode && arrange.filterName.trim() !== "" ? 1 : 0);

  function toggleFlag(f: ColorFlag) {
    const next = new Set(arrange.flagFilters);
    if (next.has(f)) next.delete(f); else next.add(f);
    setArrange({ ...arrange, flagFilters: next });
  }

  function toggleRating(r: number) {
    const next = new Set(arrange.ratingFilters);
    if (next.has(r)) next.delete(r); else next.add(r);
    setArrange({ ...arrange, ratingFilters: next });
  }

  function clearFilters() {
    setArrange({ ...arrange, filterName: "", flagFilters: new Set(), ratingFilters: new Set(), commentsOnly: false });
  }

  const selectCls = "h-8 max-w-full text-sm bg-background border border-input text-foreground rounded-lg px-2";

  // Drop "Capture Date" when no photo carries the metadata. If it was the active sort, fall back
  // to filename in the select (the grid does the same), so the control never renders blank.
  // Sort-by-rating is offered only in stars mode (flags have no numeric order).
  const sortKeys: ToolbarSortKey[] = [
    ...(captureSortAvailable ? SORT_KEYS : SORT_KEYS.filter((k) => k !== "captured")),
    ...(stars ? (["rating"] as ToolbarSortKey[]) : []),
  ];
  const sortValue = sortKeys.includes(arrange.sortKey) ? arrange.sortKey : "filename";
  // Group offers flag buckets in flags mode, rating buckets in stars mode.
  const groupKeys: ToolbarGroupKey[] = ["none", stars ? "rating" : "flag"];

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

  // Star-rating filter tokens, styled to match the colour-flag chips: solid filled pills (amber for
  // a rating, neutral for "unrated"), dimmed when off, ringed + scaled-up when active — the same
  // visual language as flagChips, just carrying a number + star instead of a colour.
  const ratingChips = (sizeCls: string) =>
    RATING_CHIPS.map((r) => {
      const active = arrange.ratingFilters.has(r);
      const label = r === 0 ? ts("unrated") : ts("nStars", { count: r });
      const unrated = r === 0;
      return (
        <button
          key={r}
          onClick={() => toggleRating(r)}
          title={label}
          aria-label={label}
          aria-pressed={active}
          className={`${sizeCls} rounded-full inline-flex items-center justify-center gap-0.5 font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
            unrated ? "bg-muted-foreground/40 text-background" : "bg-amber-400 text-amber-950"
          } ${active ? "ring-2 ring-foreground/50 scale-110" : "opacity-40 hover:opacity-80"}`}
        >
          {unrated ? <Ban size={12} /> : <><span className="text-xs tabular-nums">{r}</span><Icons.rating size={10} fill="currentColor" /></>}
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
      {groupKeys.map((k) => <option key={k} value={k}>{t(`group.${k}`)}</option>)}
    </select>
  );

  return (
    <>
    <ToolbarBand className={className}>
      {searchMode ? (
        /* Content search is the primary field. It owns the row; the filename filter moves into the
           Filter sheet so the two distinct jobs never share one ambiguous box. */
        <div className="relative flex-1 min-w-0">
          <ScanSearch size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search!.query}
            onChange={(e) => search!.setQuery(e.target.value)}
            placeholder={search!.placeholder}
            aria-label={search!.placeholder}
            className={`pl-8 h-8 text-sm w-full ${search!.query ? "pr-8" : "pr-3"}`}
          />
          {search!.query && (
            search!.loading ? (
              <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <InputClearButton onClick={() => search!.setQuery("")} label={tc("clear")} />
            )
          )}
        </div>
      ) : (
        /* Filter by filename — the primary field on the public gallery (and admin without content
           search). On a phone it flexes to share the band's row with the Filter trigger; at sm+ it
           returns to a fixed width. Right padding is only reserved when the clear button shows. */
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
      )}

      {/* Filter & sort trigger → bottom sheet. Mobile-only normally; in content-search mode it's the
          home for every filter/sort control (filename included) and shows at all sizes — but steps
          aside while a search query is active, since results are a ranking, not a filtered list. */}
      {!searching && (
        <button
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`${searchMode ? "" : "sm:hidden "}inline-flex items-center gap-1.5 h-8 shrink-0 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring ${searchMode ? "ml-auto" : ""}`}
        >
          <SlidersHorizontal size={14} />
          {t("filterSort")}
          {sheetFilterCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
              {sheetFilterCount}
            </span>
          )}
        </button>
      )}

      {/* ── Desktop inline controls (sm+) ───────────────────────────────────────────────────── */}

      {/* Flag/rating chips + comments — inline at sm+ whenever not actively searching. Shown in
          content-search mode too (admin), so the photographer can triage by flag/star with one
          click without opening the sheet; the sheet keeps them as well (it also hosts the filename
          filter + grouping there). While a query is active the whole filter row steps aside. */}
      {!searching && (features.colorFlags || features.comments) && (
        <div className="hidden sm:flex items-center gap-1.5">
          {features.colorFlags && (stars ? ratingChips("h-6 px-2") : flagChips("w-5 h-5"))}
          {features.comments && (
            <button
              onClick={() => setArrange({ ...arrange, commentsOnly: !arrange.commentsOnly })}
              title={t("hasComments")}
              aria-label={t("hasComments")}
              aria-pressed={arrange.commentsOnly}
              className={`ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                arrange.commentsOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <MessageCircle size={14} />
            </button>
          )}
        </div>
      )}

      {/* Sort + group — pushed right on wide screens. Hidden while actively searching. In content-
          search mode group moves to the sheet, keeping only Sort inline. */}
      {!searching && (
        <div className={`hidden sm:flex flex-wrap items-center gap-2 ${searchMode ? "" : "sm:ml-auto"}`}>
          {sortSelect(selectCls)}
          {sortDirButton("h-8 w-8")}
          {!searchMode && features.colorFlags && groupSelect(selectCls)}
        </div>
      )}

      {/* Result count + clear (only while filtering, and not while a content search is active) */}
      {filterActive && !searching && (
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
        <div className={searchMode ? "" : "sm:hidden"}>
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

            {/* Filename filter — only here in content-search mode (the band's primary slot is taken
                by content search). */}
            {searchMode && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t("filenameLabel")}</p>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    value={arrange.filterName}
                    onChange={(e) => setArrange({ ...arrange, filterName: e.target.value })}
                    placeholder={t("filterPlaceholder")}
                    className={`pl-8 h-11 text-sm w-full ${arrange.filterName ? "pr-8" : "pr-3"}`}
                  />
                  {arrange.filterName && (
                    <InputClearButton onClick={() => setArrange({ ...arrange, filterName: "" })} label={tc("clear")} />
                  )}
                </div>
              </div>
            )}

            {features.colorFlags && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{stars ? t("ratingLabel") : t("flagsLabel")}</p>
                <div className="flex items-center gap-2 flex-wrap">{stars ? ratingChips("h-9 px-3") : flagChips("w-8 h-8")}</div>
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
