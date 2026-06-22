// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";

import { buildNameList, buildSelectsCsv, slugify } from "./filename-export";
import type { ColorFlag, ImageResponse, Rating } from "./types";

function img(
  original_filename: string,
  opts: { rating?: Rating; color_flag?: ColorFlag; likes?: number; comment_count?: number } = {},
): ImageResponse {
  return {
    original_filename,
    rating: opts.rating ?? 0,
    color_flag: opts.color_flag ?? "none",
    likes: opts.likes ?? 0,
    comment_count: opts.comment_count ?? 0,
  } as unknown as ImageResponse;
}

describe("buildNameList", () => {
  const images = [img("IMG_1234.jpg"), img("shoot/IMG_9999.CR3")];

  it("joins with a space and strips extensions + directories by default", () => {
    expect(buildNameList(images, "space", true)).toBe("IMG_1234 IMG_9999");
  });

  it("keeps extensions when excludeExt is off", () => {
    expect(buildNameList(images, "space", false)).toBe("IMG_1234.jpg IMG_9999.CR3");
  });

  it("joins with a comma + space for Lightroom", () => {
    expect(buildNameList(images, "comma", true)).toBe("IMG_1234, IMG_9999");
  });

  it("strips Windows-style directory separators too", () => {
    expect(buildNameList([img("2024\\shoot\\DSC_1.NEF")], "space", true)).toBe("DSC_1");
  });
});

describe("buildSelectsCsv", () => {
  it("emits a header row and one row per image", () => {
    const csv = buildSelectsCsv(
      [img("IMG_1234.jpg", { rating: 5, color_flag: "green", likes: 2, comment_count: 1 })],
      true,
    );
    expect(csv).toBe("filename,rating,flag,likes,comments\r\nIMG_1234,5,green,2,1");
  });

  it("renders a 0 rating and a 'none' flag as empty cells", () => {
    const csv = buildSelectsCsv([img("a.jpg")], true);
    expect(csv).toBe("filename,rating,flag,likes,comments\r\na,,,0,0");
  });

  it("quotes filenames containing a comma (RFC 4180)", () => {
    const csv = buildSelectsCsv([img("holiday, beach.jpg")], false);
    expect(csv).toContain('"holiday, beach.jpg",');
  });

  it("doubles embedded quotes", () => {
    const csv = buildSelectsCsv([img('my "best" shot.jpg')], false);
    expect(csv).toContain('"my ""best"" shot.jpg",');
  });

  it("uses CRLF line endings", () => {
    const csv = buildSelectsCsv([img("a.jpg"), img("b.jpg")], true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Summer Wedding 2024")).toBe("summer-wedding-2024");
  });

  it("transliterates accents and drops other punctuation", () => {
    expect(slugify("Müller & Söhne!!")).toBe("muller-sohne");
  });

  it("falls back to 'gallery' when nothing survives", () => {
    expect(slugify("///")).toBe("gallery");
    expect(slugify("")).toBe("gallery");
  });
});
