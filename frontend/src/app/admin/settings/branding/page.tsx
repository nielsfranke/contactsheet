// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import type { AppSettings, BrandDisplay } from "@/lib/types";
import { applyAdminTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/admin/gallery-settings-fields";
import { FontPicker } from "@/components/admin/FontPicker";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import { Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export default function BrandingSettingsPage() {
  const qc = useQueryClient();
  const t = useTranslations("settings.branding");
  const { save, status } = useSettingsAutosave();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  // Editing buffers for free-text/colour fields (saved on blur). Discrete controls (display,
  // font) save instantly and read straight from `settings`.
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const effectiveName = instanceName ?? settings?.instance_name ?? "";
  const effDisplay = settings?.brand_display ?? "logo_name";
  const effFont = settings?.brand_font ?? "sans";
  const effColor = brandColor ?? settings?.brand_color ?? "";
  const effTagline = tagline ?? settings?.tagline ?? "";
  const effAccent = accentColor ?? settings?.accent_color ?? "#3b82f6";

  // Mirror the masthead's logic so name typography only shows when the name will render.
  const showLogoPreview = !!settings?.logo_url && effDisplay !== "name_only";
  const nameWillShow = !showLogoPreview || effDisplay === "logo_name";

  // Live accent preview; restore the persisted look if the user leaves without saving.
  function previewAccent(color: string) {
    if (HEX.test(color)) applyAdminTheme(settings?.admin_theme ?? "dark", color, settings?.accent_gradient ?? false);
  }
  useEffect(() => {
    return () => {
      const saved = qc.getQueryData<AppSettings>(["admin-settings"]);
      if (saved) applyAdminTheme(saved.admin_theme, saved.accent_color, saved.accent_gradient);
    };
  }, [qc]);

  // Gradient toggle saves instantly (like brand display/font) and previews immediately.
  const chooseGradient = (next: boolean) => {
    const accent = HEX.test(effAccent) ? effAccent : (settings?.accent_color ?? "#3b82f6");
    applyAdminTheme(settings?.admin_theme ?? "dark", accent, next);
    save({ accent_gradient: next });
  };

  // ---- on-blur savers (only persist a valid, changed value) ----
  const saveName = () => {
    const v = effectiveName.trim();
    if (!v) { setInstanceName(null); return; }       // empty is invalid → revert to stored
    if (v !== settings?.instance_name) save({ instance_name: v });
  };
  const saveTagline = () => {
    const v = effTagline.trim();
    if (v !== (settings?.tagline ?? "")) save({ tagline: v });
  };
  const saveBrandColor = () => {
    const v = effColor.trim();
    if (v && !HEX.test(v)) { setBrandColor(null); return; }  // invalid → revert
    if (v !== (settings?.brand_color ?? "")) save({ brand_color: v });
  };
  const saveAccent = () => {
    if (!HEX.test(effAccent)) {                        // invalid → revert + restore preview
      setAccentColor(null);
      if (settings) applyAdminTheme(settings.admin_theme, settings.accent_color, settings.accent_gradient);
      return;
    }
    if (effAccent !== settings?.accent_color) save({ accent_color: effAccent });
  };

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => api.adminSettings.uploadLogo(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success(t("logoUploaded"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLogoMutation = useMutation({
    mutationFn: () => api.adminSettings.deleteLogo(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success(t("logoRemoved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadLogoMutation.mutate(file);
    e.target.value = "";
  }

  if (isLoading) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>

      {/* Identity: name + masthead presentation */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div className="space-y-1">
          <Label>{t("studioName")}</Label>
          <Input
            value={effectiveName}
            onChange={(e) => setInstanceName(e.target.value)}
            onBlur={saveName}
            placeholder={t("studioNamePlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t("studioNameHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label>{t("sidebarDisplay")}</Label>
          <Segmented<BrandDisplay>
            value={effDisplay}
            onChange={(v) => save({ brand_display: v })}
            options={[
              { value: "logo_name", label: t("logoName") },
              { value: "logo_only", label: t("logoOnly") },
              { value: "name_only", label: t("nameOnly") },
            ]}
          />
          {!settings?.logo_url && effDisplay !== "name_only" && (
            <p className="text-xs text-muted-foreground">{t("noLogoHint")}</p>
          )}
        </div>

        {nameWillShow && (
          <>
            <div className="space-y-1">
              <Label>{t("tagline")} <span className="font-normal text-muted-foreground">{t("optional")}</span></Label>
              <Input
                value={effTagline}
                onChange={(e) => setTagline(e.target.value)}
                onBlur={saveTagline}
                placeholder={t("taglinePlaceholder")}
                maxLength={120}
              />
              <p className="text-xs text-muted-foreground">{t("taglineHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("nameFont")}</Label>
              <FontPicker value={effFont} onChange={(v) => save({ brand_font: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("nameColor")}</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={HEX.test(effColor) ? effColor.slice(0, 7) : "#000000"}
                  onChange={(e) => setBrandColor(e.target.value)}
                  onBlur={saveBrandColor}
                  className="h-10 w-10 cursor-pointer rounded border border-border bg-muted p-0.5"
                />
                <Input
                  value={effColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  onBlur={saveBrandColor}
                  placeholder={t("themeDefault")}
                  className="w-32 font-mono text-sm"
                />
                {effColor && (
                  <Button variant="ghost" size="sm" onClick={() => { setBrandColor(""); save({ brand_color: "" }); }}>{t("reset")}</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("nameColorHint")}</p>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>{t("accentColor")}</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={HEX.test(effAccent) ? effAccent.slice(0, 7) : "#3b82f6"}
              onChange={(e) => { setAccentColor(e.target.value); previewAccent(e.target.value); }}
              onBlur={saveAccent}
              className="h-10 w-10 cursor-pointer rounded border border-border bg-muted p-0.5"
            />
            <Input
              value={effAccent}
              onChange={(e) => { setAccentColor(e.target.value); previewAccent(e.target.value); }}
              onBlur={saveAccent}
              className="w-32 font-mono text-sm"
              placeholder="#3b82f6"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("accentColorHint")}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="accent-gradient">{t("accentGradient")}</Label>
            <p className="text-xs text-muted-foreground">{t("accentGradientHint")}</p>
          </div>
          <Switch
            id="accent-gradient"
            checked={settings?.accent_gradient ?? false}
            onCheckedChange={chooseGradient}
          />
        </div>
      </section>

      {/* Logo */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{t("logo")}</h2>

        {settings?.logo_url ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.logo_url}
              alt={t("logoAlt")}
              className="h-12 w-auto object-contain rounded border border-border p-1 bg-muted"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadLogoMutation.isPending}
              >
                <Upload size={14} className="mr-1" /> {t("replace")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => deleteLogoMutation.mutate()}
                disabled={deleteLogoMutation.isPending}
              >
                <Trash2 size={14} className="mr-1" /> {t("remove")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadLogoMutation.isPending}
          >
            <Upload size={14} className="mr-1" />
            {uploadLogoMutation.isPending ? t("uploading") : t("uploadLogo")}
          </Button>
        )}

        <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleLogoChange}
        />
      </section>
    </div>
  );
}
