// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DuplicateAction } from "@/lib/types";
import { chunkByBytes, UPLOAD_CHUNK_TARGET_BYTES } from "@/lib/upload-chunks";
import { toast } from "sonner";

/** A filename colliding with a live image in the target gallery, plus how many copies exist. */
export interface DuplicateCollision {
  name: string;
  count: number;
}

/** Open prompt awaiting the photographer's per-collision decision; `resolve(null)` cancels the batch. */
export interface DuplicatePrompt {
  collisions: DuplicateCollision[];
  resolve: (actions: Record<string, DuplicateAction> | null) => void;
}

function baseName(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? name;
}

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
// Large working documents (Photoshop .psd/.psb, layered/high-res TIFF) run to several GB — matches
// backend max_document_bytes. (Admin upload path; client uploads keep their own small cap.)
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
const DOCUMENT_EXT = [".psd", ".psb", ".tif", ".tiff"];

function isDocumentFile(f: File): boolean {
  return DOCUMENT_EXT.includes(extOf(f.name));
}

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
    const isDoc = !isVideo && isDocumentFile(f);
    const cap = isVideo ? MAX_VIDEO_BYTES : isDoc ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
    if (f.size > cap) {
      toast.error(`${f.name}: exceeds ${isVideo ? "2 GB" : isDoc ? "8 GB" : "300 MB"} limit`);
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
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null);

  const uploadFiles = useCallback(
    async (incoming: File[]) => {
      const valid = validateFiles(incoming);
      if (!valid.length) return;

      // Pre-flight: catch filename collisions *before* streaming any bytes so the photographer can
      // choose replace / keep-both / skip. A failed check (offline) just falls through to a plain
      // upload — the server keeps its legacy silent-append behaviour without the field.
      let files = valid;
      let duplicateActions: Record<string, DuplicateAction> | undefined;
      try {
        const { duplicates } = await api.images.checkDuplicates(
          galleryId,
          valid.map((f) => baseName(f.name)),
        );
        const collisions = Object.entries(duplicates).map(([name, count]) => ({ name, count }));
        if (collisions.length) {
          const decided = await new Promise<Record<string, DuplicateAction> | null>((resolve) =>
            setDuplicatePrompt({ collisions, resolve }),
          );
          setDuplicatePrompt(null);
          if (decided === null) return; // whole batch cancelled
          duplicateActions = decided;
          const skipped = new Set(
            Object.entries(decided).filter(([, a]) => a === "skip").map(([n]) => n),
          );
          files = valid.filter((f) => !skipped.has(baseName(f.name)));
          if (!files.length) return; // everything was skipped
        }
      } catch {
        /* pre-flight failed — proceed with a plain upload */
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setUploading(true);
      setProgress(0);

      // Split the batch into byte-bounded sub-requests so a large folder never trips a reverse
      // proxy's request-body ceiling (which surfaces as a bare "Network error" on the whole batch —
      // see lib/upload-chunks). Chunks upload *sequentially*: parallel requests would resurrect the
      // bulk-upload connection-pool / refetch storm the backend was hardened against. `duplicate_actions`
      // is keyed by basename, so passing the full map to every chunk is safe (the server only applies
      // entries whose file is in that request), and sequential commits keep `keep_both` versioning
      // correct across chunks (each request re-reads the now-committed names).
      const chunks = chunkByBytes(files, UPLOAD_CHUNK_TARGET_BYTES);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
      let doneBytes = 0;
      let uploaded = 0;
      try {
        for (const chunk of chunks) {
          const chunkBytes = chunk.reduce((sum, f) => sum + f.size, 0);
          await api.images.upload(
            galleryId,
            chunk,
            (pct) => setProgress(Math.round(((doneBytes + (chunkBytes * pct) / 100) / totalBytes) * 100)),
            controller.signal,
            duplicateActions,
          );
          doneBytes += chunkBytes;
          uploaded += chunk.length;
          onUploaded(); // reveal each committed wave instead of making the user wait for the whole batch
        }
        setProgress(100);
        toast.success(`${uploaded} file${uploaded > 1 ? "s" : ""} uploaded`);
      } catch (err: unknown) {
        // User-initiated cancel (xhr.abort) — a quiet info toast, not an error.
        if (err && typeof err === "object" && "aborted" in err) {
          toast.info(uploaded > 0 ? `Upload cancelled — ${uploaded} already uploaded` : "Upload cancelled");
        } else if (uploaded > 0) {
          // A later chunk failed after earlier ones committed — report the partial result so the
          // photographer knows how many landed and can retry only the remainder.
          toast.error(`Uploaded ${uploaded} of ${files.length} — the rest failed, please retry them`);
          onUploaded();
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

  return { uploadFiles, uploading, progress, openPicker, cancelUpload, inputProps, duplicatePrompt };
}
