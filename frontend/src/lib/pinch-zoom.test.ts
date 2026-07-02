// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  FIT,
  MAX_SCALE,
  clampPan,
  doubleTapTarget,
  fitSize,
  rubberBandPan,
  settle,
  softClampScale,
  zoomAround,
  type ZoomTransform,
} from "./pinch-zoom";

// A 1000×600 container; photos below are chosen so the fit box is easy to reason about.
const CW = 1000;
const CH = 600;

describe("fitSize", () => {
  it("letterboxes a landscape photo by height in a wider container", () => {
    // 3:2 photo in a 5:3 container → height-bound: 600 tall → 900 wide
    expect(fitSize(3000, 2000, CW, CH)).toEqual({ w: 900, h: 600 });
  });

  it("letterboxes a portrait photo by height", () => {
    expect(fitSize(2000, 3000, CW, CH)).toEqual({ w: 400, h: 600 });
  });

  it("pillarboxes an ultrawide photo by width", () => {
    expect(fitSize(4000, 1000, CW, CH)).toEqual({ w: 1000, h: 250 });
  });

  it("falls back to the container box when the natural size is unknown", () => {
    expect(fitSize(0, 0, CW, CH)).toEqual({ w: CW, h: CH });
  });
});

describe("zoomAround", () => {
  it("keeps the photo point under the focal point (pinch anchor invariant)", () => {
    const start: ZoomTransform = { scale: 1.5, tx: 40, ty: -30 };
    const focal = { x: 120, y: -80 };
    // The photo point currently rendered at the focal point…
    const qx = (focal.x - start.tx) / start.scale;
    const qy = (focal.y - start.ty) / start.scale;
    const next = zoomAround(start, focal, 3);
    // …must render at the focal point again at the new scale.
    expect(qx * next.scale + next.tx).toBeCloseTo(focal.x);
    expect(qy * next.scale + next.ty).toBeCloseTo(focal.y);
    expect(next.scale).toBe(3);
  });

  it("zooming around the center from fit stays centered", () => {
    expect(zoomAround({ ...FIT }, { x: 0, y: 0 }, 2)).toEqual({ scale: 2, tx: 0, ty: 0 });
  });
});

describe("clampPan", () => {
  const fit = fitSize(3000, 2000, CW, CH); // 900×600

  it("centers axes on which the scaled photo still fits", () => {
    // At 1×: 900 ≤ 1000 and 600 ≤ 600 → both axes pinned to 0.
    expect(clampPan({ scale: 1, tx: 50, ty: -20 }, fit, CW, CH)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("limits the pan to half the overhang per axis", () => {
    // At 2×: 1800×1200 → bounds ±(1800−1000)/2 = ±400 and ±(1200−600)/2 = ±300.
    const c = clampPan({ scale: 2, tx: 999, ty: -999 }, fit, CW, CH);
    expect(c).toEqual({ scale: 2, tx: 400, ty: -300 });
  });

  it("leaves an in-bounds pan untouched", () => {
    const t = { scale: 2, tx: -150, ty: 120 };
    expect(clampPan(t, fit, CW, CH)).toEqual(t);
  });
});

describe("rubberBandPan", () => {
  const fit = fitSize(3000, 2000, CW, CH); // 900×600 → at 2× bounds are ±400/±300

  it("is a no-op inside the bounds", () => {
    const t = { scale: 2, tx: 400, ty: -300 };
    expect(rubberBandPan(t, fit, CW, CH)).toEqual(t);
  });

  it("compresses the excess beyond a bound to quarter travel", () => {
    const r = rubberBandPan({ scale: 2, tx: 500, ty: -420 }, fit, CW, CH);
    expect(r.tx).toBeCloseTo(400 + 100 * 0.25);
    expect(r.ty).toBeCloseTo(-(300 + 120 * 0.25));
  });
});

describe("softClampScale", () => {
  it("passes scales inside [1, 4] through", () => {
    expect(softClampScale(1)).toBe(1);
    expect(softClampScale(2.7)).toBe(2.7);
    expect(softClampScale(MAX_SCALE)).toBe(MAX_SCALE);
  });

  it("resists below fit and floors at 0.5", () => {
    expect(softClampScale(0.8)).toBeCloseTo(0.9);
    expect(softClampScale(-5)).toBe(0.5);
  });

  it("resists beyond max", () => {
    expect(softClampScale(6)).toBeCloseTo(MAX_SCALE + 2 * 0.25);
  });
});

describe("settle", () => {
  const fit = fitSize(3000, 2000, CW, CH); // 900×600

  it("returns exactly FIT when released at/below fit scale", () => {
    expect(settle({ scale: 0.7, tx: 30, ty: 10 }, fit, CW, CH)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(settle({ scale: 1, tx: 25, ty: -25 }, fit, CW, CH)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("clamps an overshot scale back to MAX and keeps the pan in bounds", () => {
    const s = settle({ scale: 5, tx: 2000, ty: -2000 }, fit, CW, CH);
    expect(s.scale).toBe(MAX_SCALE);
    // At 4×: 3600×2400 → bounds ±1300/±900.
    expect(s.tx).toBe(1300);
    expect(s.ty).toBe(-900);
  });

  it("pulls a rubber-banded pan back inside the bounds", () => {
    const s = settle({ scale: 2, tx: 425, ty: -330 }, fit, CW, CH);
    expect(s).toEqual({ scale: 2, tx: 400, ty: -300 });
  });
});

describe("doubleTapTarget", () => {
  const fit = fitSize(3000, 2000, CW, CH); // 900×600

  it("zooms to DOUBLE_TAP_SCALE anchored at the tap point from fit", () => {
    const focal = { x: 100, y: 50 };
    const t = doubleTapTarget({ ...FIT }, focal, fit, CW, CH);
    expect(t.scale).toBe(DOUBLE_TAP_SCALE);
    // The tapped photo point stays under the finger (within pan bounds, which this focal is).
    expect(focal.x * t.scale + t.tx).toBeCloseTo(focal.x);
    expect(focal.y * t.scale + t.ty).toBeCloseTo(focal.y);
  });

  it("clamps an edge tap so the jump never overshoots the photo edge", () => {
    const t = doubleTapTarget({ ...FIT }, { x: -490, y: -290 }, fit, CW, CH);
    // At 2.5×: 2250×1500 → bounds ±625/±450. Unclamped the tap would land at 1.5×focal =
    // (735, 435): x overshoots the 625 bound and clamps; y stays inside its bound.
    expect(t.tx).toBe(625);
    expect(t.ty).toBe(435);
  });

  it("returns to fit when already zoomed", () => {
    expect(doubleTapTarget({ scale: 2.5, tx: 100, ty: 0 }, { x: 0, y: 0 }, fit, CW, CH)).toEqual({
      scale: 1,
      tx: 0,
      ty: 0,
    });
  });
});
