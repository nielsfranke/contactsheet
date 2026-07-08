// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MODE_LABELS, type GalleryPreset, type ModeType } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PresetForm } from "./PresetForm";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ModeType;
  preset: GalleryPreset | null;
}

/** Edit the instance-level default preset for a mode (app_settings.preset_presentation /
 *  preset_collaboration) — the starting point for new top-level galleries of that mode. */
export function PresetEditorModal({ open, onOpenChange, mode, preset }: Props) {
  const t = useTranslations("settings.preset");
  const qc = useQueryClient();
  const settingsKey = mode === "collaboration" ? "preset_collaboration" : "preset_presentation";

  const save = useMutation({
    mutationFn: (value: GalleryPreset | null) => api.adminSettings.update({ [settingsKey]: value }),
    onSuccess: (_, value) => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success(value ? t("presetSaved") : t("presetReset"));
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title", { mode: MODE_LABELS[mode] })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("subtitle", { mode: MODE_LABELS[mode] })}</p>
        {open && (
          <PresetForm
            mode={mode}
            preset={preset}
            pending={save.isPending}
            resetLabel={t("resetDefaults")}
            canReset={preset !== null}
            onSave={(value) => save.mutate(value)}
            onReset={() => save.mutate(null)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
