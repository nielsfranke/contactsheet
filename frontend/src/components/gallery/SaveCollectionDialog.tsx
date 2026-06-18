// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";

/** Public-gallery "save current selection as a collection" modal. Styled with the gallery-scope
 * theme tokens so it follows the gallery's bright/dark tone. The parent owns open state (mount when
 * name !== null) and the create mutation. */
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
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-popover text-popover-foreground p-6 shadow-2xl">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("collections.saveDialogTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("collections.imageCount", { count: imageCount })}</p>
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
            className="w-full h-9 rounded-lg bg-muted border border-input px-3 text-sm text-foreground placeholder:text-muted-foreground text-center outline-none focus:border-ring"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="flex-1 h-9 rounded-lg border border-border text-sm text-foreground hover:bg-accent">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={!name.trim() || saving} className="flex-1 h-9 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? tc("saving") : tc("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
