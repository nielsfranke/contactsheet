// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MODE_LABELS, type GalleryPreset, type ModeType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PresetForm } from "./PresetForm";

type Presets = Partial<Record<ModeType, GalleryPreset>> | null;

interface Props {
  presets: Presets;
  onSave: (next: Presets) => void;
}

const MODES: ModeType[] = ["presentation", "collaboration"];

/** Per-container editor for the look & behaviour templates that NEW sub-galleries inherit by mode.
 *  A Review folder can define a "Showcase look" for its Showcase sub-galleries (and vice-versa);
 *  each mode's template is optional and falls back to the instance preset when unset. */
export function SubgalleryPresetsSection({ presets, onSave }: Props) {
  const t = useTranslations("settings.gallery");
  const [editing, setEditing] = useState<ModeType | null>(null);

  function handleSave(mode: ModeType, value: GalleryPreset) {
    onSave({ ...(presets ?? {}), [mode]: value });
    setEditing(null);
  }
  function handleReset(mode: ModeType) {
    const next = { ...(presets ?? {}) };
    delete next[mode];
    onSave(Object.keys(next).length ? next : null);
    setEditing(null);
  }

  return (
    <div className="space-y-2 py-2.5">
      <div className="space-y-1">
        <Label className="font-medium">{t("subgalleryDefaultsTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("subgalleryDefaultsHint")}</p>
      </div>
      <div className="space-y-1.5">
        {MODES.map((mode) => {
          const has = !!presets?.[mode];
          return (
            <div
              key={mode}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{MODE_LABELS[mode]}</p>
                <p className="text-xs text-muted-foreground">
                  {has ? t("subgalleryPresetCustomized") : t("subgalleryPresetDefault")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(mode)}>
                {t("subgalleryPresetEdit")}
              </Button>
            </div>
          );
        })}
      </div>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("subgalleryPresetTitle", { mode: MODE_LABELS[editing] })}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("subgalleryPresetSubtitle", { mode: MODE_LABELS[editing] })}
            </p>
            <PresetForm
              mode={editing}
              preset={presets?.[editing] ?? null}
              pending={false}
              resetLabel={t("subgalleryPresetClear")}
              canReset={!!presets?.[editing]}
              onSave={(v) => handleSave(editing, v)}
              onReset={() => handleReset(editing)}
              onCancel={() => setEditing(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
