// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { collectDroppedFiles } from "@/lib/drop-files";
import { isAcceptedMedia } from "@/hooks/useImageUpload";

interface Props {
  uploading: boolean;
  progress: number;
  onFiles: (files: File[]) => void;
  onClick: () => void;
  onCancel: () => void;
}

/**
 * Canvas upload affordance (Phase C). On md+ it's a dashed drag-and-drop panel with an aggregate
 * progress bar; below md — where drag-and-drop is irrelevant and screen space is precious — it
 * collapses to a single compact button. Both share the parent's hidden file input (also used by
 * the sidebar "Upload New Files" button): clicking calls `onClick`.
 */
export function UploadZone({ uploading, progress, onFiles, onClick, onCancel }: Props) {
  const t = useTranslations("admin.uploadZone");
  const [dragging, setDragging] = useState(false);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = await collectDroppedFiles(e.dataTransfer, isAcceptedMedia);
    if (files.length) onFiles(files);
  }

  return (
    <>
      {/* Mobile: a compact button instead of the big drop zone — swaps to a progress + cancel row
          while uploading. */}
      <div className="md:hidden">
        {uploading ? (
          <div className="relative w-full overflow-hidden rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground flex items-center justify-center gap-2">
            <span>{t("uploading", { progress })}</span>
            <button
              type="button"
              onClick={onCancel}
              aria-label={t("cancel")}
              className="absolute right-2 inline-flex items-center justify-center rounded p-1 hover:bg-primary-foreground/20"
            >
              <X size={16} />
            </button>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-primary-foreground/25">
              <span className="block h-full bg-primary-foreground/80 transition-all" style={{ width: `${progress}%` }} />
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClick}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground flex items-center justify-center gap-2"
          >
            <UploadCloud size={16} />
            {t("button")}
          </button>
        )}
      </div>

      {/* md+: the dashed drag-and-drop panel. While uploading, clicks no longer open the picker
          (a separate Cancel button aborts the in-flight batch). */}
      <div
        className={cn(
          "relative hidden border-2 border-dashed rounded-xl px-6 py-12 text-center transition-colors md:block",
          uploading ? "cursor-default" : "cursor-pointer",
          dragging ? "border-ring bg-accent" : "border-border hover:border-muted-foreground bg-card/40"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={uploading ? undefined : onClick}
      >
        {uploading && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
          >
            <X size={14} /> {t("cancel")}
          </button>
        )}
        <UploadCloud size={28} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-base font-semibold text-foreground">{t("title")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
        <span className="inline-block mt-3 text-sm font-medium text-primary underline">
          {t("orClick")}
        </span>
        <p className="text-xs text-muted-foreground/70 mt-3">
          {t("formats")}
        </p>

        {uploading && (
          <div className="absolute inset-x-6 bottom-4 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </>
  );
}
