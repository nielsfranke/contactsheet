// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Images, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function PreviewMaintenance() {
  const t = useTranslations("settings.general.maintenance");
  const [busy, setBusy] = useState(false);

  async function onRegenerate() {
    setBusy(true);
    try {
      await api.adminSettings.regeneratePreviews();
      toast.success(t("started"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Images size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <Button variant="outline" onClick={onRegenerate} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} />}
        {busy ? t("regenerating") : t("button")}
      </Button>
    </section>
  );
}
