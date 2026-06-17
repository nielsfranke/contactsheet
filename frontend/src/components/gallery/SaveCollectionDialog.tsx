// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";

/** Public-gallery "save current selection as a collection" modal (dark overlay). The parent owns
 * open state (mount when name !== null) and the create mutation. */
export function SaveCollectionDialog({
  name, imageCount, saving, onNameChange, onCancel, onSubmit,
}: {
  name: string;
  imageCount: number;
  saving: boolean;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("gallery");
  const tc = useTranslations("common");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t("collections.saveDialogTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-400">{t("collections.imageCount", { count: imageCount })}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || imageCount === 0) return;
            onSubmit();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("collections.namePlaceholder")}
            maxLength={200}
            className="w-full h-9 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-sm text-zinc-100 text-center outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="flex-1 h-9 rounded-lg border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-800">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={!name.trim() || saving} className="flex-1 h-9 rounded-lg bg-zinc-100 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50">
              {saving ? tc("saving") : tc("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
