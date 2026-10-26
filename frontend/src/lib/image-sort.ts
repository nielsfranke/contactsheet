// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ImageResponse } from "./types";

/**
 * EXIF capture timestamp ("DateTimeOriginal", format "YYYY:MM:DD HH:MM:SS"). The format is
 * fixed-width and zero-padded, so the raw string compares correctly chronologically — no parsing
 * needed. Returns null when the photo has no capture date (or the EXIF was withheld).
 */
function captureKey(img: ImageResponse): string | null {
  const v = img.exif_data?.["DateTimeOriginal"];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Backend-computed capture-date rank — the only capture signal on a public gallery with EXIF off. */
function captureRank(img: ImageResponse): number | null {
  return typeof img.capture_rank === "number" ? img.capture_rank : null;
}

/** True when the photo has a capture date (used to gate the "Capture Date" sort). */
export function hasCaptureDate(img: ImageResponse): boolean {
  return captureKey(img) !== null || captureRank(img) !== null;
}

/**
 * Comparator for the "Capture Date" sort. Photos with an EXIF capture date order by it (respecting
 * `dir`: +1 ascending / -1 descending); photos without one always sort to the end, regardless of
 * direction.
 */
export function compareCaptureDate(a: ImageResponse, b: ImageResponse, dir: number): number {
  // Prefer the rank (derived from the same timestamps) and fall back to the raw EXIF string, so the
  // sort works whether or not the gallery hands out EXIF.
  const ra = captureRank(a);
  const rb = captureRank(b);
  const both = ra !== null && rb !== null;
  const ka = both ? ra : hasCaptureDate(a) ? captureKey(a) ?? "" : null;
  const kb = both ? rb : hasCaptureDate(b) ? captureKey(b) ?? "" : null;
  if (ka === null && kb === null) return 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
}
