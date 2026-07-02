// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import { MODE_LABELS, type LightboxBackdrop, type LightboxZoomMax, type ModeType, type RatingMode } from "@/lib/types";
import { Icons } from "@/lib/ui-icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/admin/gallery-settings-fields";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import { PresetEditorModal } from "@/components/admin/PresetEditorModal";
import { MessagesSquare, Sun } from "lucide-react";

const MODES: { value: ModeType; descKey: string; icon: React.ReactNode }[] = [
  { value: "collaboration", descKey: "collaborationDesc", icon: <MessagesSquare size={18} /> },
  { value: "presentation", descKey: "presentationDesc", icon: <Sun size={18} /> },
];

const RATING_MODES: { value: RatingMode; labelKey: string }[] = [
  { value: "flags", labelKey: "ratingModeFlags" },
  { value: "stars", labelKey: "ratingModeStars" },
];

const ZOOM_MAX_OPTIONS: { value: LightboxZoomMax; labelKey: string }[] = [
  { value: "200", labelKey: "zoomMax200" },
  { value: "300", labelKey: "zoomMax300" },
  { value: "400", labelKey: "zoomMax400" },
  { value: "original", labelKey: "zoomMaxOriginal" },
];

const BACKDROP_OPTIONS: { value: LightboxBackdrop; labelKey: string; swatch: string }[] = [
  { value: "dimmed", labelKey: "backdropDimmed", swatch: "bg-black/90" },
  { value: "black", labelKey: "backdropBlack", swatch: "bg-black" },
  { value: "white", labelKey: "backdropWhite", swatch: "bg-white border border-border" },
  { value: "transparent", labelKey: "backdropFrosted", swatch: "bg-[linear-gradient(rgba(255,255,255,0.9),rgba(255,255,255,0.9)),repeating-conic-gradient(#bbb_0_25%,#fff_0_50%)] bg-[length:100%_100%,12px_12px] border border-border" },
];

export default function GalleryDefaultsPage() {
  const t = useTranslations("settings.galleryDefaults");
  const { save, status } = useSettingsAutosave();
  const [editMode, setEditMode] = useState<ModeType | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  if (isLoading || !settings) {
    return <SettingsPageSkeleton />;
  }

  const effHighRes = settings.high_res_previews;
  const effBackdrop = settings.lightbox_backdrop;
  const effRatingMode = settings.rating_mode;

  const presetFor = (mode: ModeType) =>
    mode === "collaboration" ? settings.preset_collaboration : settings.preset_presentation;

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("presetsTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("presetsHint")}
          </p>
        </div>

        <div className="divide-y divide-border/60">
          {MODES.map((m) => (
            <div key={m.value} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-muted-foreground flex-shrink-0">{m.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    {t("modePreset", { mode: MODE_LABELS[m.value] })}
                    {presetFor(m.value) && (
                      <span className="text-[10px] font-normal text-muted-foreground border border-border rounded px-1 py-0.5">
                        {t("customized")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{t(m.descKey)}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditMode(m.value)}>
                {t("edit")}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Viewing — instance-wide preview resolution + lightbox backdrop */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("viewing")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("viewingHint")}
          </p>
        </div>
        <Toggle
          label={t("highRes")}
          hint={t("highResHint")}
          checked={effHighRes}
          onChange={(on) => save({ high_res_previews: on })}
        />
        <div className="space-y-1.5">
          <Label>{t("backdrop")}</Label>
          <div className="grid grid-cols-4 gap-2">
            {BACKDROP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => save({ lightbox_backdrop: opt.value })}
                className={`flex flex-col items-center gap-1.5 rounded-md border p-2 transition-colors ${
                  effBackdrop === opt.value
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <span className={`h-8 w-full rounded ${opt.swatch}`} />
                <span className="text-xs text-foreground">{t(opt.labelKey)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("backdropHint")}
          </p>
        </div>
        {/* Desktop review-lightbox zoom control (slider/wheel). Mobile pinch-zoom is unaffected. */}
        <Toggle
          label={t("zoom")}
          hint={t("zoomHint")}
          checked={settings.lightbox_zoom_enabled}
          onChange={(on) => save({ lightbox_zoom_enabled: on })}
        />
        {settings.lightbox_zoom_enabled && (
          <div className="space-y-1.5">
            <Label>{t("zoomMax")}</Label>
            <div className="grid grid-cols-4 gap-2">
              {ZOOM_MAX_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => save({ lightbox_zoom_max: opt.value })}
                  className={`rounded-md border p-2 text-xs text-foreground transition-colors ${
                    settings.lightbox_zoom_max === opt.value
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("zoomMaxHint")}</p>
          </div>
        )}
      </section>

      {/* Rating style — instance-wide: color flags vs. 1–5 stars (never both) */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("ratingStyle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("ratingStyleHint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RATING_MODES.map((opt) => {
            const active = effRatingMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => save({ rating_mode: opt.value })}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-md border p-3 transition-colors ${
                  active ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground"
                }`}
              >
                {opt.value === "stars" ? (
                  <Icons.rating size={16} className="shrink-0 text-amber-400" fill="currentColor" />
                ) : (
                  <span className="flex shrink-0 gap-0.5">
                    <span className="h-3 w-3 rounded-full bg-green-500" />
                    <span className="h-3 w-3 rounded-full bg-red-500" />
                  </span>
                )}
                <span className="min-w-0 text-center text-sm text-foreground">{t(opt.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {editMode && (
        <PresetEditorModal
          open={editMode !== null}
          onOpenChange={(open) => { if (!open) setEditMode(null); }}
          mode={editMode}
          preset={presetFor(editMode)}
        />
      )}
    </div>
  );
}
