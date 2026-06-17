// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The opacity / scrim constants for the translucent-black chrome drawn over photos. Centralised so
 * the on-photo pill look can't drift (it had already split into bg-black/45·/55·/60 across surfaces).
 * Consumed by `<OverlayPill>`; not for general use — import the component, not these strings.
 */

/** Interactive control pill at rest. */
export const OVERLAY_REST = "bg-black/55";
/** Interactive control pill on hover (full literal class incl. the `hover:` prefix so Tailwind v4's
 *  source scan generates it — concatenated results elsewhere aren't scanned). */
export const OVERLAY_HOVER = "hover:bg-black/75";
/** Read-only count/info badge background. */
export const BADGE_BG = "bg-black/60";
/** Gradient scrim laid under a tile's hover controls for contrast. */
export const OVERLAY_SCRIM = "bg-gradient-to-t from-black/50 via-transparent to-black/30";
