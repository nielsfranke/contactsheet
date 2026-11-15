// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";

import { accentUsableOn, accentForeground } from "./theme";

describe("accentUsableOn", () => {
  it("rejects the default black accent on the dark theme but keeps it on light", () => {
    expect(accentUsableOn("#000000", "dark")).toBe(false);
    expect(accentUsableOn("#000000", "light")).toBe(true);
  });

  it("rejects a near-white accent on the light theme but keeps it on dark", () => {
    expect(accentUsableOn("#f5f5f5", "light")).toBe(false);
    expect(accentUsableOn("#f5f5f5", "dark")).toBe(true);
  });

  it("keeps a mid-tone accent on both themes", () => {
    expect(accentUsableOn("#3b82f6", "light")).toBe(true);
    expect(accentUsableOn("#3b82f6", "dark")).toBe(true);
  });

  it("accepts 3-digit hex", () => {
    expect(accentUsableOn("#000", "dark")).toBe(false);
  });
});

describe("accentForeground", () => {
  it("puts light text on dark accents and dark text on light ones", () => {
    expect(accentForeground("#000000")).toBe("oklch(0.985 0 0)");
    expect(accentForeground("#ffffff")).toBe("oklch(0.145 0 0)");
  });
});
