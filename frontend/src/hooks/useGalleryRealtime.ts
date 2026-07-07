// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  adminGalleryWsUrl,
  connectRealtime,
  publicGalleryWsUrl,
  type RealtimeEvent,
} from "@/lib/realtime";

type Args =
  | { kind: "public"; shareToken: string; galleryToken: string | null }
  | { kind: "admin"; adminGalleryId: string };

/**
 * Opens the live-update socket for a gallery and maps incoming signals to React Query
 * invalidations. The normal (access-gated) refetch then refreshes the UI.
 */
export function useGalleryRealtime(args: Args): void {
  const qc = useQueryClient();
  const key = args.kind === "public" ? `public:${args.shareToken}:${args.galleryToken ?? ""}` : `admin:${args.adminGalleryId}`;

  useEffect(() => {
    const url =
      args.kind === "public"
        ? publicGalleryWsUrl(args.shareToken, args.galleryToken)
        : adminGalleryWsUrl(args.adminGalleryId);

    // Coalesce invalidations. A bulk upload emits one WS signal per image (~100 in a few seconds);
    // invalidating — and thus refetching — /images per signal hammers the backend and its DB pool
    // (see docs/architecture/db-connection-pool-under-bulk-upload.md). Collect the distinct query
    // keys touched within a short window and flush them once, capping refetches to a few per second
    // instead of one per event. 400 ms is imperceptible for other-users'-activity updates.
    const FLUSH_MS = 400;
    const pending = new Map<string, readonly unknown[]>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = (queryKey: readonly unknown[]) => {
      pending.set(JSON.stringify(queryKey), queryKey);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        const keys = [...pending.values()];
        pending.clear();
        for (const qk of keys) qc.invalidateQueries({ queryKey: qk as unknown[] });
      }, FLUSH_MS);
    };

    const handle = (event: RealtimeEvent) => {
      if (args.kind === "public") {
        const { shareToken, galleryToken } = args;
        switch (event.type) {
          case "comment":
          case "annotation":
            invalidate(["comments", shareToken]);
            invalidate(["public-images", shareToken, galleryToken]);
            break;
          case "flag":
          case "image":
            invalidate(["public-images", shareToken, galleryToken]);
            break;
          case "vote":
            invalidate(["public-votes", shareToken]);
            break;
          case "collection":
            invalidate(["public-collections", shareToken, galleryToken]);
            break;
        }
      } else {
        const id = args.adminGalleryId;
        switch (event.type) {
          case "comment":
          case "annotation":
            invalidate(["admin-comments", id]);
            invalidate(["gallery-images", id]);
            break;
          case "flag":
          case "image":
            invalidate(["gallery-images", id]);
            break;
          case "vote":
            invalidate(["votes-summary", id]);
            invalidate(["gallery-images", id]);
            break;
          case "collection":
            invalidate(["collections", id]);
            break;
        }
      }
    };

    const unsubscribe = connectRealtime(url, handle);
    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribe();
    };
    // `key` captures the identity of the connection target; args fields are read fresh on each event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key]);
}
