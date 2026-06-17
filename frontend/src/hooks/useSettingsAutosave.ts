// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppSettings, AppSettingsUpdate } from "@/lib/types";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const SETTINGS_KEY = ["admin-settings"];

/**
 * Auto-save for the admin settings pages — no Save button. `save(patch)` PATCHes a partial
 * `AppSettingsUpdate`, optimistically merges it into the `["admin-settings"]` cache (so toggles &
 * dropdowns flip instantly with no refetch flash), then reconciles with the server response.
 * `status` drives a small "Saving…/Saved" indicator; it auto-returns to idle ~2s after a save.
 *
 * Callers wire discrete controls (toggles/selects) to fire `save` immediately and text fields to
 * fire on blur (only when the value actually changed and is valid).
 */
export function useSettingsAutosave() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: (patch: AppSettingsUpdate) => api.adminSettings.update(patch),
    onMutate: async (patch) => {
      setStatus("saving");
      if (idleTimer.current) clearTimeout(idleTimer.current);
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const prev = qc.getQueryData<AppSettings>(SETTINGS_KEY);
      if (prev) qc.setQueryData<AppSettings>(SETTINGS_KEY, { ...prev, ...patch } as AppSettings);
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(SETTINGS_KEY, ctx.prev);
      setStatus("error");
    },
    onSuccess: (data) => {
      // Reconcile with the server-normalised response (e.g. masked notification secrets).
      qc.setQueryData(SETTINGS_KEY, data);
      setStatus("saved");
      idleTimer.current = setTimeout(() => setStatus("idle"), 2000);
    },
  });

  return {
    save: (patch: AppSettingsUpdate) => mutation.mutate(patch),
    status,
  };
}
