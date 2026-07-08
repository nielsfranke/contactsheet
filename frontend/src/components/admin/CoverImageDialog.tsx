// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { GalleryResponse, ImageResponse } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gallery: GalleryResponse;
  /** Photos in this gallery, to pick a cover from (empty galleries fall back to upload only). */
  images: ImageResponse[];
  /** Pin an existing photo as the cover (clears any uploaded cover server-side). */
  onPickPhoto: (imageId: string) => void;
  /** Clear a pinned photo cover (fall back to the first photo). */
  onResetCover: () => void;
  /** True while a photo-cover mutation is in flight. */
  picking?: boolean;
}

/** Set the gallery's cover/card image: upload a custom one *or* pick a photo from the gallery.
 *  Upload works even for an empty gallery that has no photo to use. */
export function CoverImageDialog({ open, onOpenChange, gallery, images, onPickPhoto, onResetCover, picking }: Props) {
  const t = useTranslations("admin.coverImage");
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["gallery", gallery.id] });
    qc.invalidateQueries({ queryKey: ["galleries"] });
  }, [qc, gallery.id]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.galleries.uploadCoverImage(gallery.id, file),
    onSuccess: () => { invalidate(); toast.success(t("updated")); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.galleries.deleteCoverImage(gallery.id),
    onSuccess: () => { invalidate(); toast.success(t("removed")); },
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
    // See HeaderImageDialog: only an OS file drop carries a real File. Dragging an on-page photo (or
    // other non-file item) yields an empty `files` list; forwarding it would POST without a file part
    // (server: "field required"). Point the user at the file picker / the pick-from-gallery grid.
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
    else toast.error(t("dropNeedsFile"));
  }

  const busy = uploadMutation.isPending || deleteMutation.isPending;
  // Only an *uploaded* cover is editable here (a photo-derived cover is managed from the grid).
  const uploaded = gallery.cover_image_filename ? gallery.cover_image_url : null;
  const donePhotos = images.filter((img) => img.processing_status === "done");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {uploaded ? (
          <div className="relative rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={uploaded} alt="Current cover" className="w-full h-44 object-cover" />
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={busy}
              title={t("removeImage")}
              className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            {t("hint")}
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
            {uploadMutation.isPending ? t("uploading") : uploaded ? t("replace") : t("dropToUpload")}
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

        {donePhotos.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t("pickFromGallery")}</span>
              {gallery.cover_image_id && !uploaded && (
                <Button variant="ghost" size="sm" className="h-auto py-0.5 text-xs" onClick={onResetCover} disabled={picking}>
                  {t("resetCover")}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2 max-h-[34vh] overflow-y-auto">
              {donePhotos.map((img) => (
                <button
                  key={img.id}
                  onClick={() => onPickPhoto(img.id)}
                  disabled={picking}
                  className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                    !uploaded && gallery.cover_image_id === img.id
                      ? "border-primary"
                      : "border-transparent hover:border-muted-foreground"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.thumb_url ?? ""} alt={img.original_filename} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

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
