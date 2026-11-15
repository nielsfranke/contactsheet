// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";

import { isGuessableToken } from "./share-token";

describe("isGuessableToken", () => {
  it("treats generated tokens as safe", () => {
    expect(isGuessableToken("33jghy80h0zy")).toBe(false);
    expect(isGuessableToken("3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b")).toBe(false);
  });

  it("flags name slugs and custom words", () => {
    expect(isGuessableToken("hochzeit-mueller")).toBe(true);
    expect(isGuessableToken("familiemueller")).toBe(true);
    expect(isGuessableToken("svit")).toBe(true);
  });

  it("flags short and digit-only tokens", () => {
    expect(isGuessableToken("a1b2c3d4")).toBe(true);
    expect(isGuessableToken("202611151234")).toBe(true);
  });
});
