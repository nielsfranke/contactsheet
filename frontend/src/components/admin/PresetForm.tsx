// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type GalleryPreset, type ModeType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  LookFields,
  type LookValues,
  OpenerFields,
  type OpenerValues,
  ReviewFields,
  type ReviewValues,
  Toggle,
} from "./gallery-settings-fields";

// Mirrors the backend Gallery model defaults (what a NULL/absent preset means).
export const PRESET_BUILTIN: Required<Omit<GalleryPreset, "bg_dimmed_color">> = {
  layout: "grid",
  opener_font: "sans",
  opener_font_size: "medium",
  opener_title_position: "center",
  opener_scrim: true,
  opener_title_shadow: false,
  preview_size: "medium",
  preview_spacing: "medium",
  preview_corners: "round",
  bg_brightness: "dark",
  downloads_enabled: true,
  client_mode_switch_enabled: false,
  enable_team_voting: false,
  color_flags_enabled: true,
  likes_enabled: false,
  comments_enabled: true,
  annotations_enabled: false,
  sets_enabled: false,
  show_filename: false,
  show_filename_lightbox: false,
  show_exif: false,
  show_iptc: false,
};

interface Props {
  /** Which mode's fields to show: Showcase = look + opener + client-switch, Review = look + feedback. */
  mode: ModeType;
  /** The current stored preset (null = all built-in defaults). */
  preset: GalleryPreset | null;
  pending: boolean;
  /** Reset action label + availability (clears the stored preset back to its fallback default). */
  resetLabel: string;
  canReset: boolean;
  onSave: (value: GalleryPreset) => void;
  onReset: () => void;
  onCancel: () => void;
}

/** The shared per-mode preset editor body (fields + footer buttons). Reused for the instance-level
 *  gallery-defaults preset and a container gallery's per-mode sub-gallery presets. */
export function PresetForm({ mode, preset, pending, resetLabel, canReset, onSave, onReset, onCancel }: Props) {
  const t = useTranslations("settings.preset");
  const tg = useTranslations("settings.gallery");
  const tc = useTranslations("common");

  const merged = { ...PRESET_BUILTIN, ...(preset ?? {}) };
  const [look, setLook] = useState<LookValues>({
    layout: merged.layout,
    preview_size: merged.preview_size,
    preview_spacing: merged.preview_spacing,
    preview_corners: merged.preview_corners,
    bg_brightness: merged.bg_brightness,
    show_filename: merged.show_filename,
    show_filename_lightbox: merged.show_filename_lightbox,
    show_exif: merged.show_exif,
    show_iptc: merged.show_iptc,
  });
  const [opener, setOpener] = useState<OpenerValues>({
    opener_font: merged.opener_font,
    opener_font_size: merged.opener_font_size,
    opener_title_position: merged.opener_title_position,
    opener_scrim: merged.opener_scrim,
    opener_title_shadow: merged.opener_title_shadow,
  });
  const [review, setReview] = useState<ReviewValues>({
    color_flags_enabled: merged.color_flags_enabled,
    likes_enabled: merged.likes_enabled,
    enable_team_voting: merged.enable_team_voting,
    comments_enabled: merged.comments_enabled,
    annotations_enabled: merged.annotations_enabled,
    sets_enabled: merged.sets_enabled,
  });
  const [downloads, setDownloads] = useState(merged.downloads_enabled);
  const [clientModeSwitch, setClientModeSwitch] = useState(merged.client_mode_switch_enabled);

  function handleSave() {
    // Each mode's preset only carries the fields that apply to it: Showcase = look + opener +
    // client mode switch, Review = look + feedback. Downloads applies to both.
    const modeFields =
      mode === "presentation"
        ? { ...opener, client_mode_switch_enabled: clientModeSwitch }
        : review;
    onSave({ ...look, ...modeFields, downloads_enabled: downloads });
  }

  return (
    <>
      <div className="max-h-[55vh] overflow-y-auto pr-1 divide-y divide-border/60">
        <div className="py-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">{t("lookLayout")}</p>
          <LookFields value={look} onChange={(patch) => setLook({ ...look, ...patch })} />
        </div>
        {mode === "presentation" ? (
          <div className="py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">{t("opener")}</p>
            <OpenerFields value={opener} onChange={(patch) => setOpener({ ...opener, ...patch })} />
            <Toggle
              label={tg("clientModeSwitchLabel")}
              hint={tg("clientModeSwitchHint")}
              checked={clientModeSwitch}
              onChange={setClientModeSwitch}
            />
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
      <div className="flex flex-col gap-3 pt-2 border-t border-border sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground max-sm:w-full"
          disabled={pending || !canReset}
          onClick={onReset}
        >
          {resetLabel}
        </Button>
        <div className="flex gap-2 max-sm:w-full">
          <Button variant="outline" size="sm" className="max-sm:flex-1" onClick={onCancel}>
            {tc("cancel")}
          </Button>
          <Button size="sm" className="max-sm:flex-1" onClick={handleSave} disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </div>
    </>
  );
}
