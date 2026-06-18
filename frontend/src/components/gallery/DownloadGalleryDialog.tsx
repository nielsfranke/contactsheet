// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useState } from "react";
import { Folder, FolderOpen, X, Loader2, AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";

export interface SubGalleryChoice {
  id: string;
  name: string;
  count: number;
}

interface Props {
  galleryName: string;
  rootCount: number;
  subGalleries: SubGalleryChoice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the ids (share tokens for public, gallery ids for admin) of the chosen subs. */
  onStart: (subgalleryIds: string[]) => void;
  preparing: boolean;
  error: string | null;
  /** Optional extra content rendered above the action buttons (e.g. admin text export). */
  extra?: React.ReactNode;
}

/** "Download Gallery" dialog: pick which sub-galleries to include in the ZIP. */
export function DownloadGalleryDialog({
  galleryName, rootCount, subGalleries: subs, open, onOpenChange, onStart, preparing, error, extra,
}: Props) {
  const t = useTranslations("gallery.downloadDialog");
  const tc = useTranslations("common");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection each time the dialog (re)opens — via the previous-state pattern.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected(new Set());
  }

  const allSelected = subs.length > 0 && selected.size === subs.length;
  const totalFiles = useMemo(
    () => rootCount + subs.filter((s) => selected.has(s.id)).reduce((n, s) => n + s.count, 0),
    [rootCount, subs, selected],
  );

  if (!open) return null;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(subs.map((s) => s.id)));
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={() => !preparing && onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-popover text-popover-foreground shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <button onClick={() => !preparing && onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {subs.length > 0 ? t("bodyWithSubs") : t("bodyNoSubs")}
        </p>

        {subs.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
            <span className={`flex h-5 w-5 items-center justify-center rounded border ${allSelected ? "bg-primary border-primary" : "border-input"}`}>
              {allSelected && <Check size={13} className="text-primary-foreground" />}
            </span>
            <input type="checkbox" className="sr-only" checked={allSelected} onChange={toggleAll} />
            {t("includeAll")}
          </label>
        )}

        {/* Folder tree */}
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {/* Root gallery (always included) — emphasized with the inverted-accent (primary) pair */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-primary text-primary-foreground">
            <FolderOpen size={16} className="shrink-0" />
            <span className="flex-1 truncate text-sm font-medium">{galleryName}</span>
            <span className="text-xs text-primary-foreground/70">
              {rootCount > 0 ? t("filesCount", { count: rootCount }) : t("empty")}
            </span>
          </div>
          {/* Sub-galleries */}
          {subs.map((s) => {
            const on = selected.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className="w-full flex items-center gap-2 pl-8 pr-3 py-2.5 text-left hover:bg-accent transition-colors"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${on ? "bg-primary border-primary" : "border-input"}`}>
                  {on && <Check size={11} className="text-primary-foreground" />}
                </span>
                <Folder size={16} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.count}</span>
              </button>
            );
          })}
        </div>

        {extra}

        {totalFiles === 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{t("noFilesWarning")}</span>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={() => onOpenChange(false)}
            disabled={preparing}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {tc("cancel")}
          </button>
          <button
            onClick={() => onStart([...selected])}
            disabled={totalFiles === 0 || preparing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
          >
            {preparing && <Loader2 size={14} className="animate-spin" />}
            {preparing ? t("preparing") : t("start")}
          </button>
        </div>
      </div>
    </div>
  );
}
