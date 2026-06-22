// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ImageResponse } from "./types";

// Pure builders for the "Copy / export filenames" dialog — exported so they can
// be unit-tested without rendering the React component.

export type Separator = "space" | "comma";

// CSV columns. Filenames feed the photo-software filter (Lightroom, Capture One,
// Photo Mechanic); the rest is review context for a spreadsheet.
export const CSV_HEADERS = ["filename", "rating", "flag", "likes", "comments"] as const;

// Strip any directory components (e.g. "shoot/IMG_1234.jpg" → "IMG_1234.jpg").
// Folder uploads can leave a relative path in original_filename on older rows.
// Handles both POSIX and Windows separators.
export function baseName(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? name;
}

// Strip a single trailing extension (e.g. "IMG_1234.jpg" → "IMG_1234"). Leaves
// dotless names and leading dots ("..cfg") untouched.
export function stripExtension(name: string): string {
  return name.replace(/\.[^.\\/]+$/, "");
}

// One display name per image, with directory components stripped and the
// extension optionally removed.
function displayName(name: string, excludeExt: boolean): string {
  const base = baseName(name);
  return excludeExt ? stripExtension(base) : base;
}

// RFC 4180 cell quoting — wrap in quotes and double any embedded quote when the
// value contains a comma, quote, CR, or LF.
export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Build a download filename stem from the gallery name.
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // drop combining marks NFKD split off (ü → u + ¨)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "gallery"
  );
}

// The clipboard / .txt payload — a separator-joined list of names.
export function buildNameList(
  images: ImageResponse[],
  separator: Separator,
  excludeExt: boolean,
): string {
  const names = images.map((img) => displayName(img.original_filename, excludeExt));
  return names.join(separator === "space" ? " " : ", ");
}

// The .csv payload — header row + one row per image. Filename column honours
// `excludeExt`; a flag of "none" and a rating of 0 render as empty cells.
export function buildSelectsCsv(images: ImageResponse[], excludeExt: boolean): string {
  const rows = images.map((img) =>
    [
      displayName(img.original_filename, excludeExt),
      img.rating || "",
      img.color_flag === "none" ? "" : img.color_flag,
      img.likes,
      img.comment_count,
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}
