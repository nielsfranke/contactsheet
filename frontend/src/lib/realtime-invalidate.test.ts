// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescedInvalidator } from "./realtime-invalidate";

describe("createCoalescedInvalidator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes each distinct key once per window, in first-seen order", () => {
    const flushed: unknown[][] = [];
    const inv = createCoalescedInvalidator((k) => flushed.push([...k]), 400);
    // A 100-image bulk upload: one signal per image, all touching the same keys.
    for (let i = 0; i < 100; i++) {
      inv.invalidate(["gallery-images", "g1"]);
      inv.invalidate(["galleries"]);
    }
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([["gallery-images", "g1"], ["galleries"]]);
  });

  it("opens a fresh window after a flush", () => {
    const flushed: unknown[][] = [];
    const inv = createCoalescedInvalidator((k) => flushed.push([...k]), 400);
    inv.invalidate(["galleries"]);
    vi.advanceTimersByTime(400);
    inv.invalidate(["galleries"]);
    expect(flushed).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(flushed).toHaveLength(2);
  });

  it("keys are compared structurally, not by identity", () => {
    const flushed: unknown[][] = [];
    const inv = createCoalescedInvalidator((k) => flushed.push([...k]), 400);
    inv.invalidate(["gallery", "abc"]);
    inv.invalidate(["gallery", "abc"]);
    inv.invalidate(["gallery", "def"]);
    vi.advanceTimersByTime(400);
    expect(flushed).toEqual([["gallery", "abc"], ["gallery", "def"]]);
  });

  it("dispose drops the pending window without flushing", () => {
    const flush = vi.fn();
    const inv = createCoalescedInvalidator(flush, 400);
    inv.invalidate(["galleries"]);
    inv.dispose();
    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
  });
});
