// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "vitest";
import { useLightboxStore } from "./lightbox";
import type { ImageResponse } from "@/lib/types";

/** Minimal ImageResponse stand-ins — the store only ever reads identity/length, never fields. */
function imgs(n: number): ImageResponse[] {
  return Array.from({ length: n }, (_, i) => ({ id: `img-${i}` }) as ImageResponse);
}

const reset = () =>
  useLightboxStore.setState({ isOpen: false, images: [], currentIndex: 0, intent: {} });

describe("lightbox store", () => {
  beforeEach(reset);

  it("starts closed and empty", () => {
    const s = useLightboxStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.images).toEqual([]);
    expect(s.currentIndex).toBe(0);
    expect(s.intent).toEqual({});
  });

  it("open seeds images, index and intent and flips isOpen", () => {
    useLightboxStore.getState().open(imgs(3), 2, { panel: "comments" });
    const s = useLightboxStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.images).toHaveLength(3);
    expect(s.currentIndex).toBe(2);
    expect(s.intent).toEqual({ panel: "comments" });
  });

  it("open defaults intent to an empty object", () => {
    useLightboxStore.getState().open(imgs(2), 0);
    expect(useLightboxStore.getState().intent).toEqual({});
  });

  it("close only clears isOpen (images/index preserved for exit animation)", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 1, { panel: "annotations" });
    store.close();
    const s = useLightboxStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.images).toHaveLength(3);
    expect(s.currentIndex).toBe(1);
  });

  it("next advances and wraps past the last image", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 0);
    store.next();
    expect(useLightboxStore.getState().currentIndex).toBe(1);
    store.next();
    expect(useLightboxStore.getState().currentIndex).toBe(2);
    store.next();
    expect(useLightboxStore.getState().currentIndex).toBe(0); // wrapped
  });

  it("prev steps back and wraps before the first image", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 0);
    store.prev();
    expect(useLightboxStore.getState().currentIndex).toBe(2); // wrapped to last
    store.prev();
    expect(useLightboxStore.getState().currentIndex).toBe(1);
  });

  it("goTo jumps to a valid index", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(5), 0);
    store.goTo(3);
    expect(useLightboxStore.getState().currentIndex).toBe(3);
  });

  it("goTo ignores out-of-range and unchanged indices (no desync)", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 1);
    store.goTo(-1);
    expect(useLightboxStore.getState().currentIndex).toBe(1);
    store.goTo(3); // length is 3 → max valid index is 2
    expect(useLightboxStore.getState().currentIndex).toBe(1);
    store.goTo(1); // same index → no-op
    expect(useLightboxStore.getState().currentIndex).toBe(1);
  });
});
