// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MODE_LABELS, type GalleryPreset, type ModeType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LookFields,
  type LookValues,
  OpenerFields,
  type OpenerValues,
  ReviewFields,
  type ReviewValues,
  Toggle,
} from "./gallery-settings-fields";
import { toast } from "sonner";

// Mirrors the backend Gallery model defaults (what a NULL preset means).
const BUILTIN: Required<Omit<GalleryPreset, "bg_dimmed_color">> = {
  layout: "grid",
  opener_font: "sans",
  opener_font_size: "medium",
  preview_size: "medium",
  preview_spacing: "medium",
  preview_corners: "round",
  bg_brightness: "dark",
  downloads_enabled: true,
  enable_team_voting: false,
  color_flags_enabled: true,
  likes_enabled: false,
  comments_enabled: true,
  annotations_enabled: false,
  sets_enabled: false,
  show_filename: false,
  show_exif: false,
  show_iptc: false,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ModeType;
  preset: GalleryPreset | null;
}

export function PresetEditorModal({ open, onOpenChange, mode, preset }: Props) {
  const t = useTranslations("settings.preset");
  const tc = useTranslations("common");
  const qc = useQueryClient();
  const settingsKey = mode === "collaboration" ? "preset_collaboration" : "preset_presentation";

  function initial() {
    const merged = { ...BUILTIN, ...(preset ?? {}) };
    return {
      look: {
        layout: merged.layout,
        preview_size: merged.preview_size,
        preview_spacing: merged.preview_spacing,
        preview_corners: merged.preview_corners,
        bg_brightness: merged.bg_brightness,
        show_filename: merged.show_filename,
        show_exif: merged.show_exif,
        show_iptc: merged.show_iptc,
      } satisfies LookValues,
      opener: {
        opener_font: merged.opener_font,
        opener_font_size: merged.opener_font_size,
      } satisfies OpenerValues,
      review: {
        color_flags_enabled: merged.color_flags_enabled,
        likes_enabled: merged.likes_enabled,
        enable_team_voting: merged.enable_team_voting,
        comments_enabled: merged.comments_enabled,
        annotations_enabled: merged.annotations_enabled,
        sets_enabled: merged.sets_enabled,
      } satisfies ReviewValues,
      downloads: merged.downloads_enabled,
    };
  }

  const [look, setLook] = useState<LookValues>(() => initial().look);
  const [opener, setOpener] = useState<OpenerValues>(() => initial().opener);
  const [review, setReview] = useState<ReviewValues>(() => initial().review);
  const [downloads, setDownloads] = useState(() => initial().downloads);

  // Re-seed from the stored preset each time the modal opens (no effect needed).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const init = initial();
      setLook(init.look);
      setOpener(init.opener);
      setReview(init.review);
      setDownloads(init.downloads);
    }
  }

  const save = useMutation({
    mutationFn: (value: GalleryPreset | null) => api.adminSettings.update({ [settingsKey]: value }),
    onSuccess: (_, value) => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success(value ? t("presetSaved") : t("presetReset"));
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    // Each mode's preset only carries the fields that apply to it: Showcase = look + opener,
    // Review = look + feedback. Downloads applies to both.
    const modeFields = mode === "presentation" ? opener : review;
    save.mutate({ ...look, ...modeFields, downloads_enabled: downloads });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title", { mode: MODE_LABELS[mode] })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("subtitle", { mode: MODE_LABELS[mode] })}
        </p>
        <div className="max-h-[55vh] overflow-y-auto pr-1 divide-y divide-border/60">
          <div className="py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">{t("lookLayout")}</p>
            <LookFields value={look} onChange={(patch) => setLook({ ...look, ...patch })} />
          </div>
          {mode === "presentation" ? (
            <div className="py-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">{t("opener")}</p>
              <OpenerFields value={opener} onChange={(patch) => setOpener({ ...opener, ...patch })} />
            </div>
          ) : (
            <div className="py-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">{t("feedback")}</p>
              <ReviewFields value={review} onChange={(patch) => setReview({ ...review, ...patch })} />
            </div>
          )}
          <div className="py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">{t("downloads")}</p>
            <Toggle
              label={t("allowDownloads")}
              hint={t("allowDownloadsHint")}
              checked={downloads}
              onChange={setDownloads}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={save.isPending || preset === null}
            onClick={() => save.mutate(null)}
          >
            {t("resetDefaults")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? tc("saving") : tc("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
