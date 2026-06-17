// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

/**
 * Live-update WebSocket client. The socket carries thin "something changed" signals; consumers
 * respond by invalidating their React Query keys (the refetch re-applies all access gating). See
 * docs/architecture/realtime-updates.md.
 *
 * Connections are ref-counted per URL so multiple hooks watching the same gallery share one socket;
 * the socket reconnects with capped backoff and closes when its last subscriber unmounts.
 */

export type RealtimeEventType =
  | "comment"
  | "annotation"
  | "flag"
  | "vote"
  | "collection"
  | "image";

export interface RealtimeEvent {
  type: RealtimeEventType;
  gallery_id: string;
  image_id?: string;
}

function wsBase(): string {
  if (typeof window === "undefined") return "";
  // Next dev rewrites proxy plain HTTP but not WebSocket upgrades, so in development we talk to the
  // FastAPI backend directly. In production everything is same-origin behind nginx.
  if (process.env.NODE_ENV === "development") {
    return `ws://${window.location.hostname}:8000`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export function publicGalleryWsUrl(shareToken: string, galleryToken: string | null): string {
  const q = galleryToken ? `?token=${encodeURIComponent(galleryToken)}` : "";
  return `${wsBase()}/api/ws/public/g/${encodeURIComponent(shareToken)}${q}`;
}

export function adminGalleryWsUrl(galleryId: string): string {
  return `${wsBase()}/api/ws/admin/galleries/${encodeURIComponent(galleryId)}`;
}

type Listener = (event: RealtimeEvent) => void;

interface Connection {
  ws: WebSocket | null;
  listeners: Set<Listener>;
  attempts: number;
  closed: boolean;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

const connections = new Map<string, Connection>();
const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
// Application close codes from the server (app/routers/realtime.py). Permanent rejections —
// reconnecting won't help (the token/gallery won't fix itself), so we stop hammering.
const PERMANENT_CLOSE_CODES = new Set([4401, 4404]);

function open(url: string, conn: Connection): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect(url, conn);
    return;
  }
  conn.ws = ws;

  ws.onopen = () => {
    conn.attempts = 0;
    // Keep proxies from idling the connection out; the server ignores inbound frames.
    conn.heartbeatTimer = setInterval(() => {
      try {
        ws.send("ping");
      } catch {
        /* closing — onclose handles reconnect */
      }
    }, HEARTBEAT_MS);
  };

  ws.onmessage = (ev) => {
    let data: unknown;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (data && typeof (data as RealtimeEvent).type === "string") {
      for (const listener of conn.listeners) listener(data as RealtimeEvent);
    }
  };

  ws.onclose = (ev) => {
    if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer);
    // A permanent rejection (auth / not found) — don't reconnect. A fresh subscribe (e.g. after
    // re-login + navigating back) tears this connection down and starts a new one.
    if (PERMANENT_CLOSE_CODES.has(ev.code)) return;
    if (!conn.closed) scheduleReconnect(url, conn);
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  };
}

function scheduleReconnect(url: string, conn: Connection): void {
  if (conn.closed) return;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** conn.attempts);
  conn.attempts += 1;
  conn.reconnectTimer = setTimeout(() => {
    if (!conn.closed) open(url, conn);
  }, delay);
}

/** Subscribe to live events for a gallery socket. Returns an unsubscribe function. */
export function connectRealtime(url: string, listener: Listener): () => void {
  let conn = connections.get(url);
  if (!conn) {
    conn = { ws: null, listeners: new Set(), attempts: 0, closed: false };
    connections.set(url, conn);
    open(url, conn);
  }
  conn.listeners.add(listener);

  return () => {
    const c = connections.get(url);
    if (!c) return;
    c.listeners.delete(listener);
    if (c.listeners.size === 0) {
      c.closed = true;
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      if (c.heartbeatTimer) clearInterval(c.heartbeatTimer);
      try {
        c.ws?.close();
      } catch {
        /* ignore */
      }
      connections.delete(url);
    }
  };
}
