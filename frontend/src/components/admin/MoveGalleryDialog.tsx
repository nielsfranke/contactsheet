// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { GalleryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { CornerDownRight, Home } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The gallery being relocated. */
  gallery: GalleryResponse;
  /** Depth-flattened gallery tree (same source as the move-images picker). */
  moveTargets: { g: GalleryResponse; depth: number }[];
  /** Ids that can't be a destination — the gallery itself and all its descendants (cycle guard). */
  excludedIds: Set<string>;
  onMove: (targetParentId: string | null) => void;
  busy: boolean;
}

/**
 * Reparents a whole gallery (with its sub-galleries) — nest it under another gallery or send it to
 * the top level. Mirrors the "Move image" picker: filterable tree, click a row to move. The current
 * parent is marked and inert. Backend (`gallery_service.move_gallery`) also rejects cycles, so the
 * `excludedIds` filter here is purely to keep impossible targets out of view.
 */
export function MoveGalleryDialog({ open, onOpenChange, gallery, moveTargets, excludedIds, onMove, busy }: Props) {
  const t = useTranslations("admin.detail");
  const tc = useTranslations("common");
  const [filter, setFilter] = useState("");

  const fq = filter.trim().toLowerCase();
  const targets = useMemo(
    () =>
      moveTargets
        .filter(({ g }) => !excludedIds.has(g.id))
        .filter(({ g }) => (fq ? g.name.toLowerCase().includes(fq) : true)),
    [moveTargets, excludedIds, fq],
  );

  const atTopLevel = gallery.parent_id === null;
  // The "Top level" row only matters when filtering by text doesn't hide it.
  const showTopLevel = fq === "" || t("moveToTopLevel").toLowerCase().includes(fq);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) setFilter(""); onOpenChange(o); }}
    >
      <DialogContent className="[&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t("moveGalleryTitle", { name: gallery.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("moveGalleryHint")}</p>
        <div className="relative">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterGalleriesPlaceholder")}
            className="h-8 pr-8 text-sm"
            autoFocus
          />
          {filter && <InputClearButton onClick={() => setFilter("")} label={tc("clear")} />}
        </div>

        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {/* Top level — always offered (except when it's already the home), so a sub-gallery can be
              promoted out of its parent without going through the All Galleries screen. */}
          {showTopLevel && (
            <button
              onClick={() => { if (!atTopLevel) onMove(null); }}
              disabled={atTopLevel || busy}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border text-sm transition-colors",
                atTopLevel ? "border-border bg-muted/40 cursor-default" : "border-border hover:bg-accent disabled:opacity-50",
              )}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <Home size={13} className="shrink-0 text-muted-foreground/70" />
                <span className={cn("font-medium truncate", atTopLevel && "text-muted-foreground")}>{t("moveToTopLevel")}</span>
                {atTopLevel && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                    {t("current")}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground text-xs shrink-0">{t("moveToTopLevelHint")}</span>
            </button>
          )}

          {targets.length === 0 && !showTopLevel ? (
            <p className="text-sm text-muted-foreground">{t("noGalleriesMatch")}</p>
          ) : (
            targets.map(({ g, depth }) => {
              const isCurrentParent = g.id === gallery.parent_id;
              return (
                <button
                  key={g.id}
                  onClick={() => { if (!isCurrentParent) onMove(g.id); }}
                  disabled={isCurrentParent || busy}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border text-sm transition-colors",
                    isCurrentParent ? "border-border bg-muted/40 cursor-default" : "border-border hover:bg-accent disabled:opacity-50",
                  )}
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {depth > 0 && <CornerDownRight size={12} className="text-muted-foreground/60 shrink-0" />}
                    <span className={cn("font-medium truncate", isCurrentParent && "text-muted-foreground")}>{g.name}</span>
                    {isCurrentParent && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                        {t("current")}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0">{t("imagesCount", { count: g.image_count })}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
