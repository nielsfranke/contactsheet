// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

const TOKEN_KEY = "cs_admin_authenticated";

// Admin flag lives in localStorage so it survives a browser/app restart — otherwise "Remember me"
// is defeated: the 30-day cookie stays valid, but a sessionStorage flag clears on app close and the
// admin layout would redirect to /login before ever asking the server (see admin/layout.tsx). The
// flag is only a hint; api.auth.me() validates against the cookie, so a stale flag (e.g. a session-
// only cookie that expired on app close) is caught there and cleared.
export function markAuthenticated() {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, "1");
}

export function clearAuthenticated() {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(TOKEN_KEY) === "1";
}

const GALLERY_TOKEN_PREFIX = "cs_gallery_token_";

export function setGalleryToken(shareToken: string, jwt: string) {
  if (typeof window !== "undefined") sessionStorage.setItem(`${GALLERY_TOKEN_PREFIX}${shareToken}`, jwt);
}

export function getGalleryToken(shareToken: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`${GALLERY_TOKEN_PREFIX}${shareToken}`);
}

export function clearGalleryToken(shareToken: string) {
  if (typeof window !== "undefined") sessionStorage.removeItem(`${GALLERY_TOKEN_PREFIX}${shareToken}`);
}
