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
import { createCoalescedInvalidator } from "@/lib/realtime-invalidate";

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

    // Coalesced: a bulk upload emits one signal per image — see lib/realtime-invalidate.ts.
    const { invalidate, dispose } = createCoalescedInvalidator((qk) =>
      qc.invalidateQueries({ queryKey: qk as unknown[] }),
    );

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
            invalidate(["public-images", shareToken, galleryToken]);
            // Likes ride the "flag" signal (public_toggle_like) — refresh every reviewer's
            // liked-set (prefix match; the reviewer name isn't known here).
            invalidate(["public-likes", shareToken]);
            break;
          case "image":
            invalidate(["public-images", shareToken, galleryToken]);
            // Uploads/deletes/moves change image_count, which gates the container view
            // (image_count === 0 → sub-gallery cover cards) — keep the gallery meta fresh too.
            invalidate(["public-gallery", shareToken, galleryToken]);
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
            invalidate(["gallery-images", id]);
            break;
          case "image":
            invalidate(["gallery-images", id]);
            // image_count feeds the detail header and the sidebar/overview cards.
            invalidate(["gallery", id]);
            invalidate(["galleries"]);
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
      dispose();
      unsubscribe();
    };
    // `key` captures the identity of the connection target; args fields are read fresh on each event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key]);
}
