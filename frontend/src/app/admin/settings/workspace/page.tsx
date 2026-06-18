// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import type {
  AdminGridMode,
  AdminGridView,
  AppSettings,
  CornersType,
  LayoutType,
  OverviewShape,
  OverviewSort,
  SizeType,
} from "@/lib/types";
import { applyAdminTheme, type AdminTheme } from "@/lib/theme";
import { Row, Segmented, SIZE_OPTS } from "@/components/admin/gallery-settings-fields";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import { Label } from "@/components/ui/label";
import { Sun, Moon } from "lucide-react";

const GRID_DEFAULTS: Required<AdminGridView> = {
  layout: "grid",
  preview_size: "medium",
  preview_spacing: "medium",
  preview_corners: "round",
};

export default function WorkspaceSettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("settings.workspace");
  const { save, status } = useSettingsAutosave();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  // Restore the persisted theme on unmount (covers the brief preview window during a save).
  useEffect(() => {
    return () => {
      const saved = qc.getQueryData<AppSettings>(["admin-settings"]);
      if (saved) applyAdminTheme(saved.admin_theme, saved.accent_color, saved.accent_gradient);
    };
  }, [qc]);

  if (isLoading || !settings) {
    return <SettingsPageSkeleton />;
  }

  const effTheme = settings.admin_theme;
  const effLocale = settings.admin_locale;
  const effMode = settings.admin_grid_mode;
  const effGrid: Required<AdminGridView> = { ...GRID_DEFAULTS, ...(settings.admin_grid_view ?? {}) };
  const effSize = settings.overview_size;
  const effShape = settings.overview_shape;
  const effSpacing = settings.overview_spacing;
  const effCorners = settings.overview_corners;
  const effSort = settings.overview_sort;

  const chooseTheme = (next: AdminTheme) => {
    applyAdminTheme(next, settings.accent_color, settings.accent_gradient);  // instant visual
    save({ admin_theme: next });
  };
  // Apply the chosen language immediately: pin the cookie (drives SSR locale) + re-render server
  // components so NextIntlClientProvider picks up the new messages, and persist it.
  const chooseLocale = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    save({ admin_locale: next });
    router.refresh();
  };
  const patchGrid = (p: Partial<AdminGridView>) => save({ admin_grid_view: { ...effGrid, ...p } });

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        {t("subtitle")}
      </p>

      {/* Theme */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-2">
        <div className="space-y-1.5">
          <Label>{t("theme")}</Label>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(
              [
                { value: "light", label: t("light"), icon: Sun },
                { value: "dark", label: t("dark"), icon: Moon },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseTheme(value)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
                  effTheme === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("themeHint")}</p>
        </div>

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <Label>{t("language")}</Label>
          <select
            value={effLocale}
            onChange={(e) => chooseLocale(e.target.value as Locale)}
            className="h-9 w-full max-w-[220px] rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t("languageHint")}</p>
        </div>
      </section>

      {/* Gallery photo grid */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-2">
        <div className="mb-1">
          <h2 className="text-sm font-medium text-foreground">{t("photoGrid")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("photoGridHint")}
          </p>
        </div>

        <Row label={t("display")} hint={t("displayHint")}>
          <Segmented<AdminGridMode>
            value={effMode}
            onChange={(v) => save({ admin_grid_mode: v })}
            options={[
              { value: "mirror", label: t("matchClient") },
              { value: "custom", label: t("custom") },
            ]}
          />
        </Row>

        {effMode === "custom" && (
          <div className="border-t border-border/60 pt-1">
            <Row label={t("layout")}>
              <Segmented<LayoutType>
                value={effGrid.layout}
                onChange={(v) => patchGrid({ layout: v })}
                options={[
                  { value: "grid", label: t("grid") },
                  { value: "masonry", label: t("masonry") },
                  { value: "list", label: t("list") },
                ]}
              />
            </Row>
            <Row label={t("previewSize")}>
              <Segmented<SizeType>
                value={effGrid.preview_size}
                onChange={(v) => patchGrid({ preview_size: v })}
                options={SIZE_OPTS}
              />
            </Row>
            <Row label={t("spacing")}>
              <Segmented<SizeType>
                value={effGrid.preview_spacing}
                onChange={(v) => patchGrid({ preview_spacing: v })}
                options={SIZE_OPTS}
              />
            </Row>
            <Row label={t("corners")}>
              <Segmented<CornersType>
                value={effGrid.preview_corners}
                onChange={(v) => patchGrid({ preview_corners: v })}
                options={[
                  { value: "round", label: t("round") },
                  { value: "square", label: t("square") },
                ]}
              />
            </Row>
          </div>
        )}
      </section>

      {/* Gallery overview */}
      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-2">
        <div className="mb-1">
          <h2 className="text-sm font-medium text-foreground">{t("overview")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("overviewHint")}
          </p>
        </div>

        <Row label={t("thumbnailSize")}>
          <Segmented<SizeType> value={effSize} onChange={(v) => save({ overview_size: v })} options={SIZE_OPTS} />
        </Row>
        <Row label={t("coverShape")}>
          <Segmented<OverviewShape>
            value={effShape}
            onChange={(v) => save({ overview_shape: v })}
            options={[
              { value: "square", label: t("square") },
              { value: "aspect", label: t("aspect") },
            ]}
          />
        </Row>
        <Row label={t("spacing")}>
          <Segmented<SizeType> value={effSpacing} onChange={(v) => save({ overview_spacing: v })} options={SIZE_OPTS} />
        </Row>
        <Row label={t("corners")}>
          <Segmented<CornersType>
            value={effCorners}
            onChange={(v) => save({ overview_corners: v })}
            options={[
              { value: "round", label: t("round") },
              { value: "square", label: t("square") },
            ]}
          />
        </Row>
        <Row label={t("sortBy")}>
          <Segmented<OverviewSort>
            value={effSort}
            onChange={(v) => save({ overview_sort: v })}
            options={[
              { value: "created", label: t("newest") },
              { value: "name", label: t("name") },
              { value: "photos", label: t("photos") },
            ]}
          />
        </Row>
      </section>
    </div>
  );
}
