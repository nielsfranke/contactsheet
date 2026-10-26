// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";

import { compareCaptureDate, hasCaptureDate } from "./image-sort";
import type { ImageResponse } from "./types";

function img(dto: string | null): ImageResponse {
  // Only the EXIF capture date matters for this comparator.
  return { exif_data: dto ? { DateTimeOriginal: dto } : {} } as unknown as ImageResponse;
}

describe("compareCaptureDate", () => {
  const A = img("2024:01:01 10:00:00");
  const B = img("2024:06:15 09:30:00");

  it("orders ascending by capture date", () => {
    expect(compareCaptureDate(A, B, 1)).toBeLessThan(0);
    expect(compareCaptureDate(B, A, 1)).toBeGreaterThan(0);
  });

  it("respects descending direction", () => {
    expect(compareCaptureDate(A, B, -1)).toBeGreaterThan(0);
  });

  it("treats equal dates as equal", () => {
    expect(compareCaptureDate(A, img("2024:01:01 10:00:00"), 1)).toBe(0);
  });

  it("sorts photos without a capture date to the end regardless of direction", () => {
    const none = img(null);
    expect(compareCaptureDate(none, A, 1)).toBe(1);
    expect(compareCaptureDate(A, none, 1)).toBe(-1);
    // Direction must not move missing-date photos off the end.
    expect(compareCaptureDate(none, A, -1)).toBe(1);
    expect(compareCaptureDate(A, none, -1)).toBe(-1);
  });

  it("treats two missing dates as equal", () => {
    expect(compareCaptureDate(img(null), img(null), 1)).toBe(0);
  });

  it("ignores blank/whitespace capture strings", () => {
    expect(compareCaptureDate(img("   "), A, 1)).toBe(1); // blank → treated as missing
  });

  it("produces a stable end-anchored ordering when used as a list comparator", () => {
    const list = [B, img(null), A];
    const sorted = [...list].sort((x, y) => compareCaptureDate(x, y, 1));
    expect(sorted).toEqual([A, B, list[1]]); // dated ascending, undated last
  });
});

describe("hasCaptureDate", () => {
  it("is true when an EXIF capture timestamp is present", () => {
    expect(hasCaptureDate(img("2024:01:01 10:00:00"))).toBe(true);
  });

  it("is false when the capture date is missing", () => {
    expect(hasCaptureDate(img(null))).toBe(false);
  });

  it("is false for a blank/whitespace capture string", () => {
    expect(hasCaptureDate(img("   "))).toBe(false);
  });
});

describe("capture_rank (public gallery with EXIF withheld)", () => {
  function ranked(rank: number | null): ImageResponse {
    return { exif_data: null, capture_rank: rank } as unknown as ImageResponse;
  }

  it("orders by rank when EXIF is absent", () => {
    const list = [ranked(2), ranked(null), ranked(0), ranked(1)];
    const sorted = [...list].sort((x, y) => compareCaptureDate(x, y, 1));
    expect(sorted.map((i) => i.capture_rank)).toEqual([0, 1, 2, null]);
  });

  it("respects direction and keeps unranked photos last", () => {
    const list = [ranked(0), ranked(null), ranked(2)];
    const sorted = [...list].sort((x, y) => compareCaptureDate(x, y, -1));
    expect(sorted.map((i) => i.capture_rank)).toEqual([2, 0, null]);
  });

  it("counts a rank as a capture date", () => {
    expect(hasCaptureDate(ranked(0))).toBe(true);
    expect(hasCaptureDate(ranked(null))).toBe(false);
  });
});
