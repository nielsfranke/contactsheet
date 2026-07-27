// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { formatExposure } from "./exif-format";

describe("formatExposure", () => {
  it("renders sub-second exposures as fractions", () => {
    expect(formatExposure(1 / 250)).toBe("1/250s");
    expect(formatExposure(0.005)).toBe("1/200s");
    expect(formatExposure(0.5)).toBe("1/2s");
  });

  it("renders exposures of one second or longer as plain seconds", () => {
    expect(formatExposure(1)).toBe("1s");
    expect(formatExposure(2)).toBe("2s");
    expect(formatExposure(1.5)).toBe("1.5s");
    expect(formatExposure(30)).toBe("30s");
  });

  it("returns null for unusable values instead of dividing by zero", () => {
    expect(formatExposure(0)).toBeNull();
    expect(formatExposure(-1)).toBeNull();
    expect(formatExposure(undefined)).toBeNull();
    expect(formatExposure("garbage")).toBeNull();
    expect(formatExposure(Infinity)).toBeNull();
  });

  it("accepts numeric strings (EXIF values sometimes arrive as strings)", () => {
    expect(formatExposure("0.004")).toBe("1/250s");
    expect(formatExposure("2")).toBe("2s");
  });
});
