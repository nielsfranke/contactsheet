// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Browser-playable video containers only — no transcoding happens server-side.
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const ACCEPTED_EXT = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm";
const MAX_IMAGE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * Whether a file is a gallery-uploadable image or video. Single source of truth
 * for "compatible content" — shared by `validateFiles` and the folder-drop
 * traversal (`collectDroppedFiles`) so they never disagree.
 */
export function isAcceptedMedia(f: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(f.type) || ACCEPTED_VIDEO_TYPES.includes(f.type);
}

function validateFiles(incoming: File[]): File[] {
  return incoming.filter((f) => {
    const isVideo = ACCEPTED_VIDEO_TYPES.includes(f.type);
    if (!isAcceptedMedia(f)) {
      toast.error(`${f.name}: unsupported file type`);
      return false;
    }
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (f.size > cap) {
      toast.error(`${f.name}: exceeds ${isVideo ? "2 GB" : "200 MB"} limit`);
      return false;
    }
    return true;
  });
}

/**
 * Shared image-upload logic for a gallery. Reports a single aggregate progress
 * value (0–100) for the in-flight batch and exposes a hidden file input that
 * any number of triggers (drop zone, sidebar button) can drive via `openPicker`.
 */
export function useImageUpload(galleryId: string, onUploaded: () => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFiles = useCallback(
    async (incoming: File[]) => {
      const valid = validateFiles(incoming);
      if (!valid.length) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setUploading(true);
      setProgress(0);
      try {
        await api.images.upload(galleryId, valid, (pct) => setProgress(pct), controller.signal);
        setProgress(100);
        onUploaded();
        toast.success(`${valid.length} file${valid.length > 1 ? "s" : ""} uploaded`);
      } catch (err: unknown) {
        // User-initiated cancel (xhr.abort) — a quiet info toast, not an error.
        if (err && typeof err === "object" && "aborted" in err) {
          toast.info("Upload cancelled");
        } else {
          toast.error(err instanceof Error ? err.message : "Upload failed");
        }
      } finally {
        setUploading(false);
        abortRef.current = null;
      }
    },
    [galleryId, onUploaded]
  );

  // Abort the in-flight upload (no-op if nothing is uploading).
  const cancelUpload = useCallback(() => abortRef.current?.abort(), []);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    uploadFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  // Render this once near the root of the consumer so every trigger shares it.
  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    multiple: true,
    accept: ACCEPTED_EXT,
    className: "hidden",
    onChange: onInputChange,
  };

  return { uploadFiles, uploading, progress, openPicker, cancelUpload, inputProps };
}
