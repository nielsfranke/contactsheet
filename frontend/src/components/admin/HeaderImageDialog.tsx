// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { GalleryResponse } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gallery: GalleryResponse;
}

export function HeaderImageDialog({ open, onOpenChange, gallery }: Props) {
  const t = useTranslations("admin.headerImage");
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["gallery", gallery.id] });
    qc.invalidateQueries({ queryKey: ["galleries"] });
  }, [qc, gallery.id]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.galleries.uploadHeaderImage(gallery.id, file),
    onSuccess: () => { invalidate(); toast.success(t("updated")); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.galleries.deleteHeaderImage(gallery.id),
    onSuccess: () => { invalidate(); toast.success(t("removed")); },
    onError: (err: Error) => toast.error(err.message),
  });

  const focusMutation = useMutation({
    mutationFn: ({ x, y }: { x: number; y: number }) =>
      api.galleries.setFocusPoint(gallery.id, x, y),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(t("notImage"));
      return;
    }
    uploadMutation.mutate(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFocusClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    focusMutation.mutate({ x, y });
  }

  const busy = uploadMutation.isPending || deleteMutation.isPending;
  const fx = gallery.header_focus_x ?? 50;
  const fy = gallery.header_focus_y ?? 50;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {gallery.header_image_url ? (
          <div className="space-y-3">
            {/* Image with focus point picker */}
            <div
              className="relative rounded-lg overflow-hidden border border-border cursor-crosshair select-none"
              onClick={handleFocusClick}
              title={t("setFocusPoint")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gallery.header_image_url}
                alt="Current header"
                className="w-full h-44 object-cover pointer-events-none"
                style={{ objectPosition: `${fx}% ${fy}%` }}
              />
              {/* Focus point indicator */}
              <div
                className="absolute w-5 h-5 rounded-full border-2 border-white bg-red-500/80 shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all"
                style={{ left: `${fx}%`, top: `${fy}%` }}
              />
              {/* Remove button */}
              <button
                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(); }}
                disabled={busy}
                title={t("removeImage")}
                className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {t("focusHint")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            {t.rich("noImage", {
              upload: (c) => (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="font-semibold text-foreground hover:underline"
                >
                  {c}
                </button>
              ),
            })}
          </p>
        )}

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          } ${busy ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={28} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {uploadMutation.isPending ? t("uploading") : gallery.header_image_url ? t("replace") : t("dropToUpload")}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        <div className="flex items-center justify-between pt-1">
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {t("uploadNew")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
