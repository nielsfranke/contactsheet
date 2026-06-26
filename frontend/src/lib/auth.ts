// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

const TOKEN_KEY = "cs_admin_authenticated";

// Admin flag lives in localStorage so it survives a browser/app restart and lets the login page
// redirect an already-authenticated visitor straight to /admin. It is *only* a hint and never a gate:
// the admin layout always validates the httponly cookie via api.auth.me() regardless of this flag
// (see admin/layout.tsx), because WebKit's ITP evicts localStorage after ~7 days while the server
// cookie lives its full 30 days — gating on the flag would log Safari admins out mid-session.
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
