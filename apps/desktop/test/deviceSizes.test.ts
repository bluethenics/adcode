/**
 * The arithmetic behind device-size preview.
 *
 * Worth testing directly because the whole feature rests on the number in the box being
 * the width the page is actually laid out at. A scale that is subtly wrong, or a parse that
 * turns `390` into `390 × 390`, produces a preview that looks plausible and tests the wrong
 * breakpoint - which is worse than no tool at all.
 */
import { describe, it, expect } from "vitest";
import {
  DEVICE_PRESETS,
  MAX_DIMENSION,
  MIN_DIMENSION,
  clampViewport,
  fitScale,
  formatSize,
  formatViewport,
  parseSize,
  parseViewport,
  presetFor,
  rotate,
} from "../src/renderer/preview/deviceSizes.ts";

describe("rotate", () => {
  it("swaps the axes", () => {
    expect(rotate({ width: 390, height: 844 })).toEqual({ width: 844, height: 390 });
  });

  it("is its own inverse", () => {
    const start = { width: 768, height: 1024 };
    expect(rotate(rotate(start))).toEqual(start);
  });
});

describe("clamping", () => {
  it("allows a width below every real device, so you can find out what breaks at 200", () => {
    expect(clampViewport({ width: 200, height: 400 }).width).toBe(200);
  });

  it("refuses a size small enough to be a typo", () => {
    expect(clampViewport({ width: 10, height: 10 })).toEqual({
      width: MIN_DIMENSION,
      height: MIN_DIMENSION,
    });
  });

  it("refuses a size large enough to wedge the pane", () => {
    expect(clampViewport({ width: 99_999, height: 99_999 })).toEqual({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
    });
  });

  it("rounds, because half a CSS pixel is not a viewport", () => {
    expect(clampViewport({ width: 390.6, height: 844.2 })).toEqual({ width: 391, height: 844 });
  });

  it("turns a half-typed box into the floor rather than NaN", () => {
    expect(clampViewport({ width: Number.NaN, height: 400 }).width).toBe(MIN_DIMENSION);
  });
});

describe("fit scale", () => {
  it("never scales up - a phone frame stretched wide is a size no device renders", () => {
    expect(fitScale({ width: 390, height: 844 }, { width: 2000, height: 2000 })).toBe(1);
  });

  it("shrinks to whichever axis is tighter", () => {
    // Width needs 0.5, height needs 0.25. The frame has to satisfy both.
    expect(fitScale({ width: 1000, height: 1000 }, { width: 500, height: 250 })).toBe(0.25);
  });

  it("scales a desktop viewport down to a narrow pane", () => {
    expect(fitScale({ width: 1440, height: 900 }, { width: 720, height: 900 })).toBe(0.5);
  });

  it("returns 1 rather than dividing by zero when the pane has no size yet", () => {
    // Happens on the first layout pass, before the stage has been measured.
    expect(fitScale({ width: 390, height: 844 }, { width: 0, height: 0 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 500, height: 500 })).toBe(1);
  });
});

describe("parsing what somebody typed", () => {
  it("reads the plain form", () => {
    expect(parseSize("390x844", 100)).toEqual({ width: 390, height: 844 });
  });

  it("reads the form the readout itself prints, so copy and paste round-trips", () => {
    const viewport = { width: 768, height: 1024 };
    expect(parseSize(formatSize(viewport), 0)).toEqual(viewport);
  });

  it("tolerates spaces, asterisks and commas", () => {
    expect(parseSize("390 x 844", 0)).toEqual({ width: 390, height: 844 });
    expect(parseSize("390*844", 0)).toEqual({ width: 390, height: 844 });
    expect(parseSize("390, 844", 0)).toEqual({ width: 390, height: 844 });
  });

  it("treats a bare number as a width and keeps the height", () => {
    // Typing just a width is the commonest thing anybody does with this box.
    expect(parseSize("500", 844)).toEqual({ width: 500, height: 844 });
  });

  it("keeps the height when only the width parses", () => {
    expect(parseSize("500 x wide", 844)).toEqual({ width: 500, height: 844 });
  });

  it("returns null for input with no number in it, rather than guessing", () => {
    expect(parseSize("", 844)).toBeNull();
    expect(parseSize("phone", 844)).toBeNull();
  });

  it("clamps what it parses", () => {
    expect(parseSize("99999x99999", 0)).toEqual({ width: MAX_DIMENSION, height: MAX_DIMENSION });
  });
});

describe("the remembered viewport", () => {
  it("round-trips through storage", () => {
    const viewport = { width: 430, height: 932 };
    expect(parseViewport(formatViewport(viewport))).toEqual(viewport);
  });

  it("reads nothing as no remembered size, not as a default one", () => {
    expect(parseViewport(null)).toBeNull();
    expect(parseViewport("")).toBeNull();
  });

  it("refuses stored junk rather than half-reading it", () => {
    expect(parseViewport("390")).toBeNull();
    expect(parseViewport("390 x 844")).toBeNull();
    expect(parseViewport("wide x tall")).toBeNull();
  });
});

describe("recognising a preset", () => {
  it("names an exact match", () => {
    expect(presetFor({ width: 390, height: 844 })?.id).toBe("phone");
  });

  it("names a rotated match, so rotating does not fall out of the preset", () => {
    expect(presetFor({ width: 844, height: 390 })?.id).toBe("phone");
  });

  it("reports a hand-typed size as custom", () => {
    expect(presetFor({ width: 511, height: 733 })).toBeNull();
  });
});

describe("the presets themselves", () => {
  it("are all within the allowed range, so selecting one is never silently clamped", () => {
    for (const preset of DEVICE_PRESETS) {
      expect(clampViewport(preset)).toEqual({ width: preset.width, height: preset.height });
    }
  });

  it("have unique ids, which the dropdown uses as its value", () => {
    expect(new Set(DEVICE_PRESETS.map((p) => p.id)).size).toBe(DEVICE_PRESETS.length);
  });

  it("cover the breakpoints people write, either side of each", () => {
    const widths = DEVICE_PRESETS.map((p) => p.width);
    expect(widths.some((w) => w < 768)).toBe(true);
    expect(widths.some((w) => w >= 768 && w < 1280)).toBe(true);
    expect(widths.some((w) => w >= 1280)).toBe(true);
  });
});
