// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, getErrorCode } from "@/lib/api";
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

  // Stop the poll loop when the owning page unmounts — otherwise a pending (or stuck) job keeps
  // hitting the status endpoint forever and triggers a download into a page the user already left.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function run(create: () => Promise<ZipJob>, onSuccess?: () => void) {
    setError(null);
    setPreparing(true);
    try {
      const job = await create();
      if (!alive.current) return;
      poll(job.id, onSuccess);
    } catch (e) {
      if (!alive.current) return;
      setError((e as Error).message);
      setPreparing(false);
    }
  }

  function poll(jobId: string, onSuccess?: () => void) {
    const tick = async () => {
      try {
        const job = await ops.getStatus(jobId);
        if (!alive.current) return;
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
        if (!alive.current) return;
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

/** Public client gallery: ZIP via the streaming endpoint — one GET the browser downloads directly,
 *  no job/poll and no "preparing" wait. The browser's own download UI shows progress + ETA (the
 *  response carries a real Content-Length). Mirrors the {start, startImages, preparing, error}
 *  interface of the job-based builder so callers are unchanged. */
export function useGalleryZip(shareToken: string, galleryToken?: string) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("errors");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function go(sel: { subs?: string[]; images?: string[] }, onSuccess?: () => void) {
    setError(null);
    setPreparing(true);
    // A plain navigation can't recover from a non-2xx: the tab would show the JSON error instead
    // of the gallery (a 12 h token expired in a long-open tab, downloads switched off meanwhile).
    // Check the gates first and keep the failure inside the dialog.
    try {
      await api.public.zipCheck(shareToken, sel, galleryToken);
    } catch (e) {
      if (!alive.current) return;
      const code = getErrorCode(e);
      setError(code && t.has(code) ? t(code) : (e as Error).message);
      setPreparing(false);
      return;
    }
    if (!alive.current) return;
    triggerBrowserDownload(api.public.zipStreamUrl(shareToken, { ...sel, galleryToken }));
    // The browser's download manager owns it from here; clear the transient button state.
    setTimeout(() => {
      if (alive.current) setPreparing(false);
    }, 1200);
    onSuccess?.();
  }

  function start(subIds: string[], onSuccess?: () => void) {
    return go({ subs: subIds }, onSuccess);
  }
  function startImages(imageIds: string[], onSuccess?: () => void) {
    return go({ images: imageIds }, onSuccess);
  }

  return { start, startImages, preparing, error, setError };
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
