// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  galleryId: string;
  hasWatermark: boolean;
  /** Called with the new stored filename after upload, or null after delete, so the
   *  parent watermark settings stay in sync (avoids a stale Save overwriting it). */
  onUploaded?: (filename: string | null) => void;
}

export function WatermarkUpload({ galleryId, hasWatermark, onUploaded }: Props) {
  const t = useTranslations("settings.uploads");
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  async function handleUpload(file: File) {
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/galleries/${galleryId}/watermark`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? t("uploadFailed"));
      }
      const body = await res.json().catch(() => ({}));
      onUploaded?.(body.filename ?? null);
      qc.invalidateQueries({ queryKey: ["gallery", galleryId] });
      toast.success(t("watermarkUploaded"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("uploadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/watermark`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(t("deleteFailed"));
      onUploaded?.(null);
      qc.invalidateQueries({ queryKey: ["gallery", galleryId] });
      toast.success(t("watermarkRemoved"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? (
          <Loader2 size={14} className="mr-1 animate-spin" />
        ) : (
          <Upload size={14} className="mr-1" />
        )}
        {hasWatermark ? t("replaceWatermark") : t("uploadWatermark")}
      </Button>
      {hasWatermark && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={loading}
          onClick={handleDelete}
        >
          <Trash2 size={14} />
        </Button>
      )}
      <span className="text-xs text-muted-foreground">{t("watermarkHint")}</span>
    </div>
  );
}
