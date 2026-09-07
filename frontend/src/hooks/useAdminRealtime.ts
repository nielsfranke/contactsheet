// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { adminWsUrl, connectRealtime, type RealtimeEvent } from "@/lib/realtime";
import { createCoalescedInvalidator } from "@/lib/realtime-invalidate";

/**
 * Opens the instance-wide admin socket (`WS /api/ws/admin`) and maps its signals to React Query
 * invalidations. Mounted once in the admin shell — not per page — so the galleries overview, the
 * nav tree and an open detail page all pick up gallery-list changes made *outside this browser*
 * (an API-token client such as a desktop uploader, or a second admin tab). The per-gallery socket
 * (`useGalleryRealtime`) keeps carrying the in-gallery signals.
 *
 * `enabled` gates the connection on the shell's auth check: opening it before the cookie is
 * validated would just get a 4401 and mark the connection dead.
 */
export function useAdminRealtime(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const { invalidate, dispose } = createCoalescedInvalidator((qk) =>
      qc.invalidateQueries({ queryKey: qk as unknown[] }),
    );

    const handle = (event: RealtimeEvent) => {
      switch (event.type) {
        case "gallery":
          // The tree feeds the overview, the sidebar nav and a detail page's sub-gallery block +
          // breadcrumb (`findChildren` / `findParent` over ["galleries"]).
          invalidate(["galleries"]);
          // The changed gallery's own detail query (rename / move / cover / header). Invalidating
          // an uncached key is a no-op, so no cache lookup is needed.
          invalidate(["gallery", event.gallery_id]);
          break;
      }
    };

    const unsubscribe = connectRealtime(adminWsUrl(), handle);
    return () => {
      dispose();
      unsubscribe();
    };
  }, [qc, enabled]);
}
