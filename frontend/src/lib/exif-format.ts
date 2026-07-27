// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EXIF ExposureTime (seconds) → display string, photography-style: fractions below one second
 * ("1/250s"), plain seconds at or above ("2s", "1.5s"). Returns null for zero/negative/NaN so
 * the caller can skip the field entirely (a naive 1/exp would render "1/1s" for long exposures
 * and divide by zero for 0).
 */
export function formatExposure(exposure: unknown): string | null {
  const exp = Number(exposure);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  if (exp >= 1) {
    const rounded = Math.round(exp * 10) / 10;
    return `${rounded}s`;
  }
  return `1/${Math.round(1 / exp)}s`;
}
