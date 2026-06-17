// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ZipJob } from "@/lib/types";

function triggerBrowserDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface ZipOps {
  create: (sel: { subIds: string[]; imageIds: string[] }) => Promise<ZipJob>;
  getStatus: (jobId: string) => Promise<ZipJob>;
  downloadUrl: (jobId: string) => string;
}

/** Create a ZIP job (whole gallery + sub-galleries, or a filtered image selection),
 *  poll until ready, then trigger the browser download. Works for both the public and
 *  admin endpoints via the supplied `ops`. */
function useZipBuilder(ops: ZipOps) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function run(create: () => Promise<ZipJob>, onSuccess?: () => void) {
    setError(null);
    setPreparing(true);
    try {
      const job = await create();
      poll(job.id, onSuccess);
    } catch (e) {
      setError((e as Error).message);
      setPreparing(false);
    }
  }

  function poll(jobId: string, onSuccess?: () => void) {
    const tick = async () => {
      try {
        const job = await ops.getStatus(jobId);
        if (job.status === "ready") {
          triggerBrowserDownload(ops.downloadUrl(jobId));
          setPreparing(false);
          onSuccess?.();
        } else if (job.status === "error") {
          setError(job.error_message ?? "Could not prepare the download.");
          setPreparing(false);
        } else {
          timer.current = setTimeout(tick, 1500);
        }
      } catch (e) {
        setError((e as Error).message);
        setPreparing(false);
      }
    };
    timer.current = setTimeout(tick, 1200);
  }

  /** Download the whole gallery plus the chosen sub-galleries. */
  function start(subIds: string[], onSuccess?: () => void) {
    return run(() => ops.create({ subIds, imageIds: [] }), onSuccess);
  }
  /** Download a specific (e.g. filtered) selection of images from this gallery. */
  function startImages(imageIds: string[], onSuccess?: () => void) {
    return run(() => ops.create({ subIds: [], imageIds }), onSuccess);
  }

  return { start, startImages, preparing, error, setError };
}

/** Public client gallery: ZIP via the share-token endpoints. */
export function useGalleryZip(shareToken: string, galleryToken?: string) {
  return useZipBuilder({
    create: ({ subIds, imageIds }) =>
      imageIds.length
        ? api.public.createFilteredZip(shareToken, imageIds, galleryToken)
        : api.public.createZip(shareToken, subIds, galleryToken),
    getStatus: (jobId) => api.public.getZip(shareToken, jobId, galleryToken),
    downloadUrl: (jobId) => api.public.zipDownloadUrl(shareToken, jobId),
  });
}

/** Admin gallery: ZIP via the admin-authenticated endpoints. */
export function useAdminGalleryZip(galleryId: string) {
  return useZipBuilder({
    create: ({ subIds, imageIds }) =>
      imageIds.length
        ? api.galleries.createFilteredZip(galleryId, imageIds)
        : api.galleries.createMultiZip(galleryId, subIds),
    getStatus: (jobId) => api.galleries.getZip(galleryId, jobId),
    downloadUrl: (jobId) => api.galleries.zipDownloadUrl(galleryId, jobId),
  });
}
