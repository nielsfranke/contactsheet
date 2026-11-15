// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a share token looks hand-picked (and so guessable) rather than generated. Generated
 * tokens are legacy UUIDs or the backend's 12-char `[a-z0-9]` random string (~62 bits); custom and
 * gallery-name slugs are words, often hyphenated. This only drives an advisory nudge towards a
 * password, so it errs towards silence on random-looking strings: a false warning on every freshly
 * generated link taught photographers to ignore it.
 */
export function isGuessableToken(token: string): boolean {
  if (UUID_RE.test(token)) return false;
  if (token.length < 12) return true;   // older 8-char randoms included: short is enumerable
  if (token.includes("-")) return true; // slugs from names / custom words
  if (!/\d/.test(token)) return true;   // a generated 12-char token has a digit ~98% of the time
  return !/[a-z]/.test(token);          // digits only (a date, a phone number) is guessable too
}
