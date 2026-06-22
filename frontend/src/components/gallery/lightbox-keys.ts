// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from "react";

export type LightboxKeyAction = "close" | "next" | "prev" | null;

/** Minimal shape of the bits of a KeyboardEvent the mapping needs — keeps {@link lightboxKeyAction}
 *  pure and unit-testable without a DOM. A real KeyboardEvent satisfies it. */
export interface LightboxKeyInput {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

function isEditableTarget(target: LightboxKeyInput["target"]): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable === true;
}

/**
 * Map a keydown to a lightbox action. Returns null when the key isn't a nav key. Arrow navigation
 * is suppressed while a modifier is held or focus is in an editable field — otherwise typing a
 * comment/annotation and using ←/→ to move the caret would flip the visible slide. Escape always
 * closes (matches the long-standing behaviour).
 */
export function lightboxKeyAction(e: LightboxKeyInput): LightboxKeyAction {
  if (e.key === "Escape") return "close";
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return null;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (isEditableTarget(e.target)) return null;
  return e.key === "ArrowRight" ? "next" : "prev";
}

/** Window-level keyboard navigation for the lightbox (Escape / ←/→), guarded by {@link lightboxKeyAction}. */
export function useLightboxKeys(handlers: { close: () => void; next: () => void; prev: () => void }) {
  const { close, next, prev } = handlers;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = lightboxKeyAction({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: e.target as LightboxKeyInput["target"],
      });
      if (action === "close") close();
      else if (action === "next") next();
      else if (action === "prev") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, next, prev]);
}
