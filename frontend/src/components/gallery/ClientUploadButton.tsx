// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UploadCloud, X } from "lucide-react";
import { api, getErrorCode } from "@/lib/api";
import { useReviewerStore } from "@/store/reviewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

const ACCEPT = "image/jpeg,image/png,image/webp";

interface Props {
  shareToken: string;
  galleryToken?: string;
  /** When the gallery requires approval, uploads land pending — message accordingly, don't refetch. */
  moderation?: boolean;
  /** Button classes so the trigger matches the surrounding layout (collab / presentation). */
  className?: string;
}

/**
 * "Add photos" trigger for galleries with client upload enabled. Prompts for a reviewer name
 * (reused from the voting store) on first use, then uploads via the public endpoint with progress
 * and refreshes the gallery so the new photos appear.
 */
export function ClientUploadButton({ shareToken, galleryToken, moderation, className }: Props) {
  const t = useTranslations("gallery.upload");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const reviewerName = useReviewerStore((s) => s.name);
  const setName = useReviewerStore((s) => s.setName);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [needName, setNeedName] = useState(false);
  const [nameValue, setNameValue] = useState("");

  function openPicker() {
    inputRef.current?.click();
  }

  function handleClick() {
    if (reviewerName) openPicker();
    else setNeedName(true);
  }

  function confirmName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    setName(trimmed);
    setNeedName(false);
    // Defer so the file dialog opens in the same gesture chain.
    setTimeout(openPicker, 0);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same files later
    if (files.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setPct(0);
    try {
      const uploaded = await api.public.uploadImages(
        shareToken,
        files,
        useReviewerStore.getState().name ?? "Guest",
        galleryToken,
        setPct,
        controller.signal,
      );
      const n = uploaded.length;
      if (moderation) {
        // Held in the approval queue — it won't appear publicly yet, so don't refetch the grid.
        toast.success(t("addedPending", { count: n }));
      } else {
        toast.success(t("added", { count: n }));
        const refresh = () => qc.invalidateQueries({ queryKey: ["public-images", shareToken, galleryToken] });
        refresh();
        // Thumbnails are generated in the background — refresh again once they're likely ready.
        setTimeout(refresh, 3000);
      }
    } catch (err) {
      if (err && typeof err === "object" && "aborted" in err) {
        // User-initiated cancel — a quiet info toast, not an error.
        toast.info(t("cancelled"));
      } else {
        // Localize known backend error codes; fall back to the raw English detail for unknown ones.
        const code = getErrorCode(err);
        const msg = code && te.has(code) ? te(code) : err instanceof Error ? err.message : t("failed");
        toast.error(msg);
      }
    } finally {
      setUploading(false);
      setPct(0);
      abortRef.current = null;
    }
  }

  // Abort the in-flight upload (no-op if nothing is uploading).
  function cancelUpload() {
    abortRef.current?.abort();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={handleFiles}
      />
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={handleClick} disabled={uploading} className={className}>
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
          {uploading ? t("uploading", { pct }) : t("addPhotos")}
        </button>
        {uploading && (
          <button
            type="button"
            onClick={cancelUpload}
            aria-label={tc("cancel")}
            title={tc("cancel")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <X size={15} />
          </button>
        )}
      </span>

      {needName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-popover text-popover-foreground p-8 shadow-2xl">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15">
                <UploadCloud size={22} className="text-blue-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t("promptTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("promptBody")}</p>
              </div>
            </div>
            <form onSubmit={confirmName} className="space-y-3">
              <Input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder={t("yourName")}
                className="text-center"
                maxLength={100}
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setNeedName(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" className="flex-1" disabled={!nameValue.trim()}>
                  {t("continue")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
