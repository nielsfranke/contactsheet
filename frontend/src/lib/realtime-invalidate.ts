// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Coalesces React Query invalidations triggered by realtime signals.
 *
 * A bulk upload emits one WS signal per image (~100 in a few seconds); invalidating — and thus
 * refetching — per signal hammers the backend and its DB pool (see
 * docs/architecture/db-connection-pool-under-bulk-upload.md). Collect the distinct query keys
 * touched within a short window and flush them once, capping refetches to a few per second
 * instead of one per event. 400 ms is imperceptible for other-users'-activity updates.
 *
 * Pure (no React / query-client import) so both realtime hooks share it and it unit-tests in
 * the node vitest environment.
 */

export type QueryKey = readonly unknown[];

export interface CoalescedInvalidator {
  /** Queue a key; it flushes with everything else queued in the same window. */
  invalidate(queryKey: QueryKey): void;
  /** Drop the pending window (unmount). Queued keys are discarded, not flushed. */
  dispose(): void;
}

export const REALTIME_FLUSH_MS = 400;

export function createCoalescedInvalidator(
  flush: (queryKey: QueryKey) => void,
  flushMs: number = REALTIME_FLUSH_MS,
): CoalescedInvalidator {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    invalidate(queryKey) {
      pending.set(JSON.stringify(queryKey), queryKey);
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const keys = [...pending.values()];
        pending.clear();
        for (const qk of keys) flush(qk);
      }, flushMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
