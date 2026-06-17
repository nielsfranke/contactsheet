// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

const TOKEN_KEY = "cs_admin_authenticated";

export function markAuthenticated() {
  if (typeof window !== "undefined") sessionStorage.setItem(TOKEN_KEY, "1");
}

export function clearAuthenticated() {
  if (typeof window !== "undefined") sessionStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(TOKEN_KEY) === "1";
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
