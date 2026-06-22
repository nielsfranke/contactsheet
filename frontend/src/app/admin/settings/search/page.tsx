// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { Toggle } from "@/components/admin/gallery-settings-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import type { SemanticSearchSettings } from "@/lib/types";

const DEFAULT_CFG: SemanticSearchSettings = {
  enabled: false,
  model: "siglip2-base-multilingual",
  default_threshold: 0.08,
  index_originals: true,
};

// SigLIP cosine matches cluster low (~0.05–0.12), so the slider operates in a 0–30% band rather
// than a full 0–100% that would put every useful value in the first sliver.
const THRESHOLD_MAX_PCT = 30;

export default function SearchSettingsPage() {
  const t = useTranslations("settings.search");
  const qc = useQueryClient();
  const { save, status } = useSettingsAutosave();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  const cfg = settings?.semantic_search ?? DEFAULT_CFG;
  const enabled = cfg.enabled;

  // Poll index progress while anything is still pending, so the bar advances live.
  const { data: idx } = useQuery({
    queryKey: ["semantic-status"],
    queryFn: () => api.adminSettings.semanticStatus(),
    enabled: enabled,
    refetchInterval: (q) => (q.state.data && q.state.data.pending > 0 ? 3000 : false),
  });

  const reindex = useMutation({
    mutationFn: () => api.adminSettings.reindexSemantic(),
    onSuccess: (data) => {
      qc.setQueryData(["semantic-status"], data);
      toast.success(t("reindexQueued"));
    },
    onError: () => toast.error(t("reindexFailed")),
  });

  if (isLoading) return <SettingsPageSkeleton />;

  const update = (patch: Partial<SemanticSearchSettings>) =>
    save({ semantic_search: { ...cfg, ...patch } });

  const sidecarReachable = !!idx?.sidecar;
  // picdrop-style "accuracy": present the cosine cutoff as a percentage the user nudges.
  const accuracyPct = Math.round(cfg.default_threshold * 100);

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>

      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <Toggle
          label={t("enable")}
          hint={t("enableHint")}
          checked={enabled}
          onChange={(on) => update({ enabled: on })}
        />

        {enabled && !idx?.configured && (
          <p className="rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs p-3">
            {t("notConfigured")}
          </p>
        )}
      </section>

      {enabled && (
        <>
          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">{t("accuracyTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("accuracyHint")}</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("threshold")}</Label>
                <span className="text-sm font-medium tabular-nums text-foreground">{accuracyPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={THRESHOLD_MAX_PCT}
                step={1}
                value={accuracyPct}
                onChange={(e) => update({ default_threshold: Number(e.target.value) / 100 })}
                className="w-full accent-primary"
                aria-label={t("threshold")}
              />
              <p className="text-xs text-muted-foreground">{t("thresholdHint")}</p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-foreground">{t("indexTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("sidecar")}:{" "}
                  <span className={sidecarReachable ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                    {sidecarReachable ? t("sidecarOnline") : t("sidecarOffline")}
                  </span>
                  {idx?.model ? ` · ${idx.model}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reindex.mutate()}
                disabled={reindex.isPending || !sidecarReachable}
              >
                {t("reindex")}
              </Button>
            </div>

            {idx && (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${idx.total ? Math.round((idx.indexed / idx.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>{t("statIndexed", { n: idx.indexed, total: idx.total })}</span>
                  {idx.pending > 0 && <span>{t("statPending", { n: idx.pending })}</span>}
                  {idx.error > 0 && (
                    <span className="text-destructive">{t("statError", { n: idx.error })}</span>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
