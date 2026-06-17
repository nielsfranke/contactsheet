// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Clock, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { ImageResponse } from "@/lib/types";

/**
 * Shown above the admin grid when a gallery has client uploads awaiting approval. Surfaces the
 * count and a one-click "Approve all" (the per-tile Approve/Reject handle individual decisions).
 */
export function PendingReviewBanner({ galleryId, images }: { galleryId: string; images: ImageResponse[] }) {
  const t = useTranslations("admin.imageGrid");
  const qc = useQueryClient();
  const pendingIds = images.filter((i) => i.moderation_status === "pending").map((i) => i.id);

  const approveAll = useMutation({
    mutationFn: () => api.images.approveBulk(galleryId, pendingIds),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["gallery-images", galleryId] });
      toast.success(t("approved", { count: res.approved }));
    },
  });

  if (pendingIds.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Clock size={15} className="text-amber-500 shrink-0" />
        {t("pendingCount", { count: pendingIds.length })}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={approveAll.isPending}
        onClick={() => approveAll.mutate()}
      >
        {approveAll.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {t("approveAll")}
      </Button>
    </div>
  );
}
