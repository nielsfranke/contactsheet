// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { ImageResponse } from "@/lib/types";
import { photoSrc, variantSrc } from "./lightbox-image-src";

function img(over: Partial<ImageResponse> = {}): ImageResponse {
  return {
    id: "abc",
    small_url: "/s.jpg",
    medium_url: "/m.jpg",
    thumb_url: "/t.jpg",
    ...over,
  } as ImageResponse;
}

const noWm = { watermarkEnabled: false, shareToken: "tok" };

describe("variantSrc", () => {
  it("serves the static rendition when no watermark is active", () => {
    expect(variantSrc(img(), "small", noWm)).toBe("/s.jpg");
    expect(variantSrc(img(), "medium", noWm)).toBe("/m.jpg");
  });

  it("routes through the share-token proxy when a watermark is active", () => {
    const ctx = { watermarkEnabled: true, shareToken: "tok" };
    expect(variantSrc(img(), "small", ctx)).toBe("/api/public/g/tok/images/abc/small");
    expect(variantSrc(img(), "medium", ctx)).toBe("/api/public/g/tok/images/abc/medium");
  });

  it("does not proxy without a share token even if watermark is on (admin path)", () => {
    const ctx = { watermarkEnabled: true, shareToken: undefined };
    expect(variantSrc(img(), "medium", ctx)).toBe("/m.jpg");
  });

  it("falls back small → medium → thumb when larger tiers are missing", () => {
    expect(variantSrc(img({ small_url: null }), "small", noWm)).toBe("/m.jpg");
    expect(variantSrc(img({ small_url: null, medium_url: null }), "small", noWm)).toBe("/t.jpg");
    expect(variantSrc(img({ medium_url: null }), "medium", noWm)).toBe("/t.jpg");
  });

  it("returns an empty string when no rendition exists yet (still processing)", () => {
    const blank = img({ small_url: null, medium_url: null, thumb_url: null });
    expect(variantSrc(blank, "small", noWm)).toBe("");
    expect(variantSrc(blank, "medium", noWm)).toBe("");
  });
});

describe("photoSrc", () => {
  it("picks small on compact viewports and medium otherwise", () => {
    expect(photoSrc(img(), true, noWm)).toBe("/s.jpg");
    expect(photoSrc(img(), false, noWm)).toBe("/m.jpg");
  });
});
