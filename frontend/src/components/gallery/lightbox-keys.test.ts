// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { lightboxKeyAction } from "./lightbox-keys";

describe("lightboxKeyAction", () => {
  it("maps Escape to close", () => {
    expect(lightboxKeyAction({ key: "Escape" })).toBe("close");
  });

  it("maps the arrow keys to next/prev", () => {
    expect(lightboxKeyAction({ key: "ArrowRight" })).toBe("next");
    expect(lightboxKeyAction({ key: "ArrowLeft" })).toBe("prev");
  });

  it("ignores keys that aren't navigation keys", () => {
    expect(lightboxKeyAction({ key: "a" })).toBeNull();
    expect(lightboxKeyAction({ key: "Enter" })).toBeNull();
    expect(lightboxKeyAction({ key: " " })).toBeNull();
  });

  it("suppresses arrow nav while a modifier is held", () => {
    expect(lightboxKeyAction({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowLeft", ctrlKey: true })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowRight", altKey: true })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowLeft", shiftKey: true })).toBeNull();
  });

  it("suppresses arrow nav when typing in an editable field (caret movement, not slide nav)", () => {
    expect(lightboxKeyAction({ key: "ArrowRight", target: { tagName: "INPUT" } })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowLeft", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowRight", target: { tagName: "SELECT" } })).toBeNull();
    expect(lightboxKeyAction({ key: "ArrowLeft", target: { isContentEditable: true } })).toBeNull();
  });

  it("still navigates when focus is on a non-editable element", () => {
    expect(lightboxKeyAction({ key: "ArrowRight", target: { tagName: "DIV" } })).toBe("next");
    expect(lightboxKeyAction({ key: "ArrowRight", target: { tagName: "BUTTON" } })).toBe("next");
  });

  it("closes on Escape even from within an input", () => {
    expect(lightboxKeyAction({ key: "Escape", target: { tagName: "INPUT" } })).toBe("close");
  });
});
