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
        className="w-full max-w-lg rounded-2xl bg-white text-zinc-900 shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <button onClick={() => !preparing && onOpenChange(false)} className="text-zinc-400 hover:text-zinc-700">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-zinc-600">
          {subs.length > 0 ? t("bodyWithSubs") : t("bodyNoSubs")}
        </p>

        {subs.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
            <span className={`flex h-5 w-5 items-center justify-center rounded border ${allSelected ? "bg-zinc-900 border-zinc-900" : "border-zinc-300"}`}>
              {allSelected && <Check size={13} className="text-white" />}
            </span>
            <input type="checkbox" className="sr-only" checked={allSelected} onChange={toggleAll} />
            {t("includeAll")}
          </label>
        )}

        {/* Folder tree */}
        <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {/* Root gallery (always included) */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-900 text-white">
            <FolderOpen size={16} className="shrink-0" />
            <span className="flex-1 truncate text-sm font-medium">{galleryName}</span>
            <span className="text-xs text-white/70">
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
                className="w-full flex items-center gap-2 pl-8 pr-3 py-2.5 text-left hover:bg-zinc-50 transition-colors"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${on ? "bg-zinc-900 border-zinc-900" : "border-zinc-300"}`}>
                  {on && <Check size={11} className="text-white" />}
                </span>
                <Folder size={16} className="shrink-0 text-zinc-500" />
                <span className="flex-1 truncate text-sm">{s.name}</span>
                <span className="text-xs text-zinc-500">{s.count}</span>
              </button>
            );
          })}
        </div>

        {extra}

        {totalFiles === 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{t("noFilesWarning")}</span>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={() => onOpenChange(false)}
            disabled={preparing}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            {tc("cancel")}
          </button>
          <button
            onClick={() => onStart([...selected])}
            disabled={totalFiles === 0 || preparing}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 text-white px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-40"
          >
            {preparing && <Loader2 size={14} className="animate-spin" />}
            {preparing ? t("preparing") : t("start")}
          </button>
        </div>
      </div>
    </div>
  );
}
