// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Browser-playable video containers only — no transcoding happens server-side.
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

// Extension-based acceptance: browsers send an empty/octet-stream MIME for TIFF, PSD and camera
// RAW, so matching on `f.type` alone would silently drop them. The backend re-validates by magic.
const ACCEPTED_VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm"];
const ACCEPTED_IMAGE_EXT = [
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".psd", ".psb",
  // camera RAW
  ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".dng", ".raf", ".orf",
  ".rw2", ".pef", ".srw", ".rwl", ".dcr", ".kdc", ".mrw", ".x3f", ".3fr", ".mef", ".iiq",
];
// Image extensions only — reused by the public client-upload picker (no video there).
export const ACCEPTED_IMAGE_EXT_ATTR = ACCEPTED_IMAGE_EXT.join(",");
export const ACCEPTED_EXT = [...ACCEPTED_IMAGE_EXT, ...ACCEPTED_VIDEO_EXT].join(",");

const MAX_IMAGE_BYTES = 300 * 1024 * 1024; // 300 MB — matches backend max_upload_bytes
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isVideoFile(f: File): boolean {
  return ACCEPTED_VIDEO_TYPES.includes(f.type) || ACCEPTED_VIDEO_EXT.includes(extOf(f.name));
}

/**
 * Whether a file is a gallery-uploadable image or video. Single source of truth
 * for "compatible content" — shared by `validateFiles` and the folder-drop
 * traversal (`collectDroppedFiles`) so they never disagree. Matches by MIME or by
 * extension (RAW/TIFF/PSD arrive with no usable MIME).
 */
export function isAcceptedMedia(f: File): boolean {
  const ext = extOf(f.name);
  return (
    ACCEPTED_IMAGE_TYPES.includes(f.type) ||
    ACCEPTED_VIDEO_TYPES.includes(f.type) ||
    ACCEPTED_IMAGE_EXT.includes(ext) ||
    ACCEPTED_VIDEO_EXT.includes(ext)
  );
}

function validateFiles(incoming: File[]): File[] {
  return incoming.filter((f) => {
    if (!isAcceptedMedia(f)) {
      toast.error(`${f.name}: unsupported file type`);
      return false;
    }
    const isVideo = isVideoFile(f);
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (f.size > cap) {
      toast.error(`${f.name}: exceeds ${isVideo ? "2 GB" : "300 MB"} limit`);
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
