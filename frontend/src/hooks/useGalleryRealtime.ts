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

    const handle = (event: RealtimeEvent) => {
      if (args.kind === "public") {
        const { shareToken, galleryToken } = args;
        switch (event.type) {
          case "comment":
          case "annotation":
            qc.invalidateQueries({ queryKey: ["comments", shareToken] });
            qc.invalidateQueries({ queryKey: ["public-images", shareToken, galleryToken] });
            break;
          case "flag":
          case "image":
            qc.invalidateQueries({ queryKey: ["public-images", shareToken, galleryToken] });
            break;
          case "vote":
            qc.invalidateQueries({ queryKey: ["public-votes", shareToken] });
            break;
          case "collection":
            qc.invalidateQueries({ queryKey: ["public-collections", shareToken, galleryToken] });
            break;
        }
      } else {
        const id = args.adminGalleryId;
        switch (event.type) {
          case "comment":
          case "annotation":
            qc.invalidateQueries({ queryKey: ["admin-comments", id] });
            qc.invalidateQueries({ queryKey: ["gallery-images", id] });
            break;
          case "flag":
          case "image":
            qc.invalidateQueries({ queryKey: ["gallery-images", id] });
            break;
          case "vote":
            qc.invalidateQueries({ queryKey: ["votes-summary", id] });
            qc.invalidateQueries({ queryKey: ["gallery-images", id] });
            break;
          case "collection":
            qc.invalidateQueries({ queryKey: ["collections", id] });
            break;
        }
      }
    };

    return connectRealtime(url, handle);
    // `key` captures the identity of the connection target; args fields are read fresh on each event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key]);
}
