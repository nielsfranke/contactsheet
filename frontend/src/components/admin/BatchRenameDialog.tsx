// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";

type Mode = "sequence" | "find" | "affix";

/** Split a filename into stem + extension. Treats a leading dot (dotfile) and a missing
 *  dot as "no extension", so the extension is always re-appended verbatim by every mode. */
function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

const PREVIEW_LIMIT = 12;

/**
 * Batch rename for the admin selection. Computes new `original_filename`s entirely
 * client-side (extension always preserved) and hands the changed `{ id, name }[]` to
 * `onApply`, which PATCHes each image sequentially (see useGalleryDetail). Images are
 * passed in current grid order so "Number" mode matches what the admin sees.
 */
export function BatchRenameDialog({
  open,
  onOpenChange,
  images,
  onApply,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  images: ImageResponse[];
  onApply: (renames: { id: string; name: string }[]) => void;
  busy: boolean;
}) {
  const t = useTranslations("admin.detail");
  const tc = useTranslations("common");

  const [mode, setMode] = useState<Mode>("sequence");
  // sequence
  const [base, setBase] = useState("");
  const [start, setStart] = useState(1);
  const [padding, setPadding] = useState(3);
  const [separator, setSeparator] = useState("-");
  // find & replace
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  // affix
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");

  // New full name for every selected image (extension preserved). Order = grid order.
  const computed = useMemo(() => {
    return images.map((img, i) => {
      const { stem, ext } = splitExt(img.original_filename);
      let newStem = stem;
      if (mode === "sequence") {
        const num = String(start + i).padStart(Math.max(1, padding), "0");
        newStem = base ? `${base}${separator}${num}` : num;
      } else if (mode === "find") {
        newStem = find ? stem.split(find).join(replace) : stem;
      } else {
        newStem = `${prefix}${stem}${suffix}`;
      }
      const name = `${newStem}${ext}`.trim();
      return { id: img.id, old: img.original_filename, name };
    });
  }, [images, mode, base, start, padding, separator, find, replace, prefix, suffix]);

  // Only rows that actually change and produce a non-empty name get applied.
  const changes = useMemo(
    () => computed.filter((c) => c.name && c.name !== c.old),
    [computed],
  );

  const hasDuplicates = useMemo(() => {
    const names = computed.map((c) => c.name).filter(Boolean);
    return new Set(names).size !== names.length;
  }, [computed]);

  const numField = "h-8 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("batchRenameTitle", { count: images.length })}</DialogTitle>
        </DialogHeader>

        {/* Mode switch */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["sequence", "find", "affix"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(m === "sequence" ? "batchModeSequence" : m === "find" ? "batchModeFind" : "batchModeAffix")}
            </button>
          ))}
        </div>

        {/* Mode controls */}
        {mode === "sequence" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("batchBaseName")}</Label>
              <Input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder={t("batchBaseNamePlaceholder")}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("batchSeparator")}</Label>
                <Input value={separator} onChange={(e) => setSeparator(e.target.value)} className={numField} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("batchStartNumber")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={start}
                  onChange={(e) => setStart(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className={numField}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("batchPadding")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={6}
                  value={padding}
                  onChange={(e) => setPadding(Math.min(6, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className={numField}
                />
              </div>
            </div>
          </div>
        )}

        {mode === "find" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("batchFind")}</Label>
              <Input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={t("batchFindPlaceholder")}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("batchReplace")}</Label>
              <Input value={replace} onChange={(e) => setReplace(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
        )}

        {mode === "affix" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("batchPrefix")}</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-8 text-sm" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("batchSuffix")}</Label>
              <Input value={suffix} onChange={(e) => setSuffix(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("batchPreview")}</Label>
            <span className="text-[11px] text-muted-foreground">{t("batchExtNote")}</span>
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {computed.slice(0, PREVIEW_LIMIT).map((c) => {
              const changed = c.name && c.name !== c.old;
              return (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={c.old}>{c.old}</span>
                  <ArrowRight size={12} className="shrink-0 text-muted-foreground/60" />
                  <span
                    className={cn("min-w-0 flex-1 truncate", changed ? "font-medium text-foreground" : "text-muted-foreground/60")}
                    title={changed ? c.name : t("batchUnchanged")}
                  >
                    {changed ? c.name : t("batchUnchanged")}
                  </span>
                </div>
              );
            })}
            {computed.length > PREVIEW_LIMIT && (
              <p className="pt-1 text-[11px] text-muted-foreground">
                {t("batchMoreItems", { count: computed.length - PREVIEW_LIMIT })}
              </p>
            )}
          </div>
          {hasDuplicates && <p className="text-[11px] text-amber-600 dark:text-amber-500">{t("batchDuplicateWarning")}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button size="sm" onClick={() => onApply(changes)} disabled={changes.length === 0 || busy}>
            {busy ? tc("saving") : changes.length === 0 ? t("batchNoChanges") : t("batchApply", { count: changes.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
