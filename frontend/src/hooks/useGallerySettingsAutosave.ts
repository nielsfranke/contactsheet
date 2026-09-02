// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GalleryResponse, GalleryUpdate } from "@/lib/types";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

// Keys carried in a patch but not part of GalleryResponse — stripped from the optimistic cache
// merge so a write-only password never lands in the query cache.
const NON_RESPONSE_KEYS = new Set(["password", "apply_to_subgalleries"]);

// Fields the gallery tree (left rail / overview) actually renders. The cost of autosave is the
// `["galleries"]` tree refetch, not the tiny write — so we only refetch the tree when one of these
// changes (or on a cascade, which can rewrite children). Look/behaviour toggles skip it entirely.
// Fields the overview tiles / tree render — a save touching one refreshes the `galleries` list
// (headline is the tile subtitle; a password flips the tile's lock badge).
const TREE_FIELDS = new Set<keyof GalleryUpdate>(["name", "headline", "mode", "pinned", "password"]);

/**
 * Per-gallery autosave for `GallerySettingsModal` — a gallery-scoped sibling of
 * `useSettingsAutosave`. `save(patch)` PATCHes a partial `GalleryUpdate`, optimistically merges it
 * into the `["gallery", id]` cache (toggles flip instantly, no refetch flash), then reconciles with
 * the server response. `status` drives the `SaveStatus` indicator (auto-returns to idle ~2s later).
 *
 * Callers wire discrete controls (toggles/selects) to fire `save` immediately and text fields on
 * blur (only when the value actually changed and is valid).
 */
export function useGallerySettingsAutosave(galleryId: string) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const galleryKey = ["gallery", galleryId];

  const mutationKey = ["gallery-settings", galleryId];
  const mutation = useMutation({
    mutationKey,
    mutationFn: (patch: GalleryUpdate) => api.galleries.update(galleryId, patch),
    onMutate: async (patch) => {
      setStatus("saving");
      if (idleTimer.current) clearTimeout(idleTimer.current);
      await qc.cancelQueries({ queryKey: galleryKey });
      const prev = qc.getQueryData<GalleryResponse>(galleryKey);
      if (prev) {
        const merge = Object.fromEntries(
          Object.entries(patch).filter(([k]) => !NON_RESPONSE_KEYS.has(k)),
        );
        qc.setQueryData<GalleryResponse>(galleryKey, { ...prev, ...merge } as GalleryResponse);
      }
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(galleryKey, ctx.prev);
      setStatus("error");
    },
    onSuccess: (data, patch) => {
      // Two toggles flipped quickly: the first response still carries the second's *old* value,
      // and writing it over the cache would visibly revert that toggle for one round-trip. Only
      // the last in-flight save reconciles the cache (its response reflects every patch so far).
      if (qc.isMutating({ mutationKey }) <= 1) qc.setQueryData(galleryKey, data);
      const touchesTree =
        !!patch.apply_to_subgalleries ||
        Object.keys(patch).some((k) => TREE_FIELDS.has(k as keyof GalleryUpdate));
      if (touchesTree) qc.invalidateQueries({ queryKey: ["galleries"] });
      // A cascade rewrote every descendant — their detail queries (30 s stale) must not keep the
      // pre-cascade values, or a blur-save in a child's modal would send the old ones back.
      if (patch.apply_to_subgalleries) qc.invalidateQueries({ queryKey: ["gallery"] });
      setStatus("saved");
      idleTimer.current = setTimeout(() => setStatus("idle"), 2000);
    },
  });
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); }, []);

  return {
    save: (patch: GalleryUpdate) => mutation.mutate(patch),
    status,
  };
}
