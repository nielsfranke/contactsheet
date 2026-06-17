// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  galleryId: string;
  headerImageUrl: string | null;
}

export function HeaderImageUpload({ galleryId, headerImageUrl }: Props) {
  const t = useTranslations("settings.uploads");
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.galleries.uploadHeaderImage(galleryId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", galleryId] });
      toast.success(t("headerUpdated"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.galleries.deleteHeaderImage(galleryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gallery", galleryId] });
      toast.success(t("headerRemoved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-3">
      {headerImageUrl && (
        <div className="rounded overflow-hidden border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={headerImageUrl} alt="Header" className="w-full h-32 object-cover" />
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          <Upload size={14} className="mr-1" />
          {uploadMutation.isPending ? t("uploading") : headerImageUrl ? t("replace") : t("uploadHeader")}
        </Button>
        {headerImageUrl && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            <Trash2 size={14} className="mr-1" /> {t("remove")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("headerHint")}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
