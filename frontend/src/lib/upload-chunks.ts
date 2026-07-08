// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin gallery upload sends its whole drag-drop batch as a single multipart POST. A large
 * folder (e.g. 105 × 50 MB ≈ 5 GB) then exceeds the request-body ceiling of a reverse proxy in
 * front of the app — nginx `client_max_body_size`, a Caddy `request_body max_size`, Cloudflare's
 * 100 MB, … — and the upload dies with a bare "Network error": the connection is reset on the
 * `Content-Length` before a byte is processed. Splitting the batch into byte-bounded sub-requests
 * keeps every POST comfortably under any realistic cap, independent of the operator's proxy config.
 */

// Target bytes per upload request. Small enough to clear common outer-proxy body caps (the app's
// own nginx allows 8 GB on the upload route, but a proxy in front is often stricter — 512 MB / 1 GB
// / 2 GB are all seen in the wild), large enough that a typical folder needs only a handful of
// sequential requests. Lower this if an even stricter proxy is in play (e.g. Cloudflare's 100 MB).
export const UPLOAD_CHUNK_TARGET_BYTES = 256 * 1024 * 1024; // 256 MB

/**
 * Greedily pack items into byte-bounded groups, preserving order. A single item larger than
 * `maxBytes` gets its own group — one file can't be split across requests (the server needs whole
 * files), so the operator's proxy must still admit that lone file. An empty input yields no groups.
 */
export function chunkByBytes<T extends { size: number }>(items: T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    if (current.length > 0 && size + item.size > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
