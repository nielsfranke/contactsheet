// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/admin/gallery-settings-fields";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { ResetDangerZone } from "@/components/admin/ResetDangerZone";
import { BackupRestore } from "@/components/admin/BackupRestore";
import { PreviewMaintenance } from "@/components/admin/PreviewMaintenance";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";

/**
 * Upstream source repository — the default when no custom source_url is set.
 * AGPL-3.0 §13 requires offering the *running* source to users, so forks that
 * modify ContactSheet should point this at their own repository (Settings → General).
 */
const DEFAULT_SOURCE_URL = "https://github.com/nielsfranke/contactsheet";

/** Mirrors `components/ui/input.tsx` (multi-line, auto-height). No `Textarea` primitive exists and
 * two fields don't justify adding one — revisit if a third long-text setting appears. */
const LEGAL_TEXTAREA_CLS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings.general");
  const { save, status } = useSettingsAutosave();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const effectiveBaseUrl = baseUrl ?? settings?.public_base_url ?? "";

  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const effectiveSourceUrl = sourceUrl ?? settings?.source_url ?? "";
  const sourceLink = (settings?.source_url ?? "").trim() || DEFAULT_SOURCE_URL;

  const [retention, setRetention] = useState<number | null>(null);
  const effectiveRetention = retention ?? settings?.activity_ip_retention_days ?? 90;

  // Legal pages: free text, saved on blur (like the URL fields). Blank clears the page — its
  // footer link then disappears and /impressum (or /privacy) 404s.
  const [impressum, setImpressum] = useState<string | null>(null);
  const effectiveImpressum = impressum ?? settings?.impressum ?? "";
  const [privacy, setPrivacy] = useState<string | null>(null);
  const effectivePrivacy = privacy ?? settings?.privacy ?? "";

  if (isLoading) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div className="space-y-1">
          <Label>{t("publicBaseUrl")}</Label>
          <Input
            value={effectiveBaseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => {
              const next = effectiveBaseUrl.trim();
              if (next !== (settings?.public_base_url ?? "")) save({ public_base_url: next });
            }}
            placeholder="https://gallery.example.com"
          />
          <p className="text-xs text-muted-foreground">
            {t("publicBaseUrlHint")}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("activityTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("activityHint")}</p>
        </div>
        <Toggle
          label={t("ipLogging")}
          hint={t("ipLoggingHint")}
          checked={settings?.activity_ip_logging ?? false}
          onChange={(on) => save({ activity_ip_logging: on })}
        />
        {(settings?.activity_ip_logging ?? false) && (
          <div className="space-y-1">
            <Label>{t("ipRetention")}</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={effectiveRetention}
              onChange={(e) => setRetention(Number(e.target.value))}
              onBlur={() => {
                const days = Math.min(3650, Math.max(1, Math.round(effectiveRetention) || 90));
                setRetention(days);
                if (days !== settings?.activity_ip_retention_days) {
                  save({ activity_ip_retention_days: days });
                }
              }}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">{t("ipRetentionHint")}</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <h2 className="text-sm font-medium text-foreground">{t("legalTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("legalHint")}</p>

        <div className="space-y-1">
          <Label htmlFor="impressum">{t("impressum")}</Label>
          <textarea
            id="impressum"
            rows={8}
            value={effectiveImpressum}
            onChange={(e) => setImpressum(e.target.value)}
            onBlur={() => {
              const next = effectiveImpressum.trim();
              if (next !== (settings?.impressum ?? "")) save({ impressum: next });
            }}
            placeholder={t("impressumPlaceholder")}
            className={LEGAL_TEXTAREA_CLS}
          />
          <p className="text-xs text-muted-foreground">{t("impressumHint")}</p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="privacy">{t("privacy")}</Label>
          <textarea
            id="privacy"
            rows={8}
            value={effectivePrivacy}
            onChange={(e) => setPrivacy(e.target.value)}
            onBlur={() => {
              const next = effectivePrivacy.trim();
              if (next !== (settings?.privacy ?? "")) save({ privacy: next });
            }}
            placeholder={t("privacyPlaceholder")}
            className={LEGAL_TEXTAREA_CLS}
          />
          <p className="text-xs text-muted-foreground">{t("privacyHint")}</p>
        </div>

        <Toggle
          label={t("supportLink")}
          hint={t("supportLinkHint")}
          checked={settings?.support_link_enabled ?? false}
          onChange={(v) => save({ support_link_enabled: v })}
        />
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <h2 className="text-sm font-medium text-foreground">{t("aboutTitle")}</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("version")}</span>
            <span className="font-medium text-foreground tabular-nums">ContactSheet v{settings?.version}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("license")}</span>
            <span className="font-medium text-foreground">AGPL-3.0-or-later</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("sourceCode")}</span>
            <a
              href={sourceLink}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {t("sourceLink")}
            </a>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("sourceHint")}</p>
        <div className="space-y-1 pt-1">
          <Label>{t("sourceUrl")}</Label>
          <Input
            value={effectiveSourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            onBlur={() => {
              const next = effectiveSourceUrl.trim();
              if (next !== (settings?.source_url ?? "")) save({ source_url: next });
            }}
            placeholder={DEFAULT_SOURCE_URL}
          />
          <p className="text-xs text-muted-foreground">{t("sourceUrlHint")}</p>
        </div>
      </section>

      <BackupRestore />

      <PreviewMaintenance />

      <ResetDangerZone />
    </div>
  );
}
