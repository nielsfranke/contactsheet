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

describe("syncImages", () => {
  beforeEach(reset);

  it("replaces the list with fresh data and keeps the current slide by id", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 1);
    const fresh = imgs(3); // new object identities (a refetch)
    store.syncImages(fresh);
    expect(useLightboxStore.getState().images).toBe(fresh);
    expect(useLightboxStore.getState().currentIndex).toBe(1); // still img-1
  });

  it("follows the current slide when its position changes", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 2); // on img-2
    const reordered = [imgs(3)[2], imgs(3)[0], imgs(3)[1]];
    store.syncImages(reordered);
    expect(useLightboxStore.getState().currentIndex).toBe(0);
  });

  it("clamps when the current slide disappeared and closes on an empty list", () => {
    const store = useLightboxStore.getState();
    store.open(imgs(3), 2);
    store.syncImages(imgs(2)); // img-2 deleted
    expect(useLightboxStore.getState().currentIndex).toBe(1);
    store.syncImages([]);
    expect(useLightboxStore.getState().isOpen).toBe(false);
  });

  it("no-ops while closed and on identical content", () => {
    const store = useLightboxStore.getState();
    const list = imgs(3);
    store.syncImages(list); // closed → ignored
    expect(useLightboxStore.getState().images).toEqual([]);
    store.open(list, 0);
    const before = useLightboxStore.getState().images;
    store.syncImages([...list]); // same item identities → no state churn
    expect(useLightboxStore.getState().images).toBe(before);
  });
});
