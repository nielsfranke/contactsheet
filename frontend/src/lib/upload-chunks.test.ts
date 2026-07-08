// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { chunkByBytes } from "./upload-chunks";

const f = (size: number, name = "") => ({ size, name });

describe("chunkByBytes", () => {
  it("returns no chunks for an empty batch", () => {
    expect(chunkByBytes([], 100)).toEqual([]);
  });

  it("keeps a batch under the limit as a single chunk", () => {
    const items = [f(30), f(30), f(30)]; // 90 <= 100
    expect(chunkByBytes(items, 100)).toEqual([items]);
  });

  it("packs greedily up to the limit", () => {
    const chunks = chunkByBytes([f(40), f(40), f(40), f(40)], 100); // 40+40 | 40+40
    expect(chunks.map((c) => c.length)).toEqual([2, 2]);
  });

  it("splits when the running total would exceed the limit", () => {
    const chunks = chunkByBytes([f(60), f(60), f(60)], 100); // 60 | 60 | 60
    expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it("gives an oversized single item its own chunk", () => {
    const chunks = chunkByBytes([f(30), f(250), f(30)], 100); // 30 | 250 | 30
    expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
    expect(chunks[1][0].size).toBe(250);
  });

  it("preserves order and never drops or duplicates items", () => {
    const items = Array.from({ length: 10 }, (_, i) => f(50, `f${i}`));
    const chunks = chunkByBytes(items, 120); // pairs of 2 (100), a 3rd (150) would overflow
    expect(chunks.flat()).toEqual(items);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 2, 2, 2]);
  });
});
