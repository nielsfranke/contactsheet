// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { GalleryResponse } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Shuffle, Type, AlertTriangle } from "lucide-react";
import { copyText } from "@/lib/utils";

// A UUIDv4 share token means the link is unguessable; anything else is a custom slug.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Strategy = "named" | "random" | "custom";

export function ShareDialog({
  gallery,
  open,
  onOpenChange,
}: {
  gallery: GalleryResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.share");
  const tc = useTranslations("common");
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  const [slug, setSlug] = useState(gallery.share_token);
  const [error, setError] = useState<string | null>(null);

  // Reset the editable slug to the stored token each time the dialog (re)opens — done during
  // render via the previous-state pattern rather than an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSlug(gallery.share_token);
      setError(null);
    }
  }

  const base = (settings?.public_base_url || "").trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const shareUrl = `${base}/g/${gallery.share_token}`;

  const isGuessable = !UUID_RE.test(gallery.share_token);

  const mutation = useMutation({
    mutationFn: (body: { strategy: Strategy; value?: string }) =>
      api.galleries.setShareToken(gallery.id, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      setSlug(updated.share_token);
      setError(null);
      toast.success(t("updated"));
    },
    onError: (err: Error) => setError(err.message),
  });

  async function copyLink() {
    if (await copyText(shareUrl)) {
      toast.success(t("copied"));
    } else {
      toast.error(t("copyFailed"));
    }
  }

  const trimmedSlug = slug.trim();
  const unchanged = trimmedSlug === gallery.share_token;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {/* Current link */}
        <div className="space-y-1">
          <Label>{t("linkLabel")}</Label>
          <div className="flex gap-2">
            <Input readOnly value={shareUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="sm" onClick={copyLink}>
              <Copy size={14} className="mr-1" /> {t("copy")}
            </Button>
          </div>
          {!settings?.public_base_url && (
            <p className="text-xs text-muted-foreground">
              {t("tip")}
            </p>
          )}
        </div>

        {/* Customize slug */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>{t("customLink")}</Label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">/g/</span>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setError(null);
              }}
              placeholder={t("slugPlaceholder")}
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              onClick={() => mutation.mutate({ strategy: "custom", value: trimmedSlug })}
              disabled={mutation.isPending || unchanged || !trimmedSlug}
            >
              {tc("save")}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            {t("slugHint")}
          </p>

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate({ strategy: "named" })}
              disabled={mutation.isPending}
            >
              <Type size={14} className="mr-1" /> {t("useName")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate({ strategy: "random" })}
              disabled={mutation.isPending}
            >
              <Shuffle size={14} className="mr-1" /> {t("randomShort")}
            </Button>
          </div>
        </div>

        {isGuessable && !gallery.has_password && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {t("guessableWarning")}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
