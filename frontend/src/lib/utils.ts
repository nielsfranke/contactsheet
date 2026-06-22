// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a UUIDv4 that also works outside secure contexts.
 *
 * `crypto.randomUUID()` is only defined on HTTPS or localhost. A self-hosted
 * ContactSheet reached over plain HTTP (a LAN IP, or an HTTP reverse proxy)
 * leaves it `undefined`, so calling it throws and any click handler that mints
 * an id silently dies. Fall back to `crypto.getRandomValues` (widely available
 * on insecure origins), then to `Math.random` as a last resort.
 */
export function uid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Copy text to the clipboard, returning whether it succeeded.
 *
 * `navigator.clipboard` is another secure-context-only API: undefined over plain
 * HTTP (LAN IP / HTTP reverse proxy), where the modern call throws. Fall back to
 * the legacy `document.execCommand("copy")` via an off-screen textarea so copying
 * still works on insecure origins. Never throws — callers branch on the result.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // `navigator.clipboard` is undefined on insecure origins; the call then throws
    // a TypeError and we fall through to the legacy path below.
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Trigger a client-side download of a text file via an in-memory Blob — no
 * server round-trip. Works on insecure origins (LAN IP / HTTP proxy) where the
 * clipboard API is unavailable. The caller owns the `mime` and (for CSV) any
 * BOM.
 */
export function downloadTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
