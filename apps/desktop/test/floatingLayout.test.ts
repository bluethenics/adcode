/**
 * Floating-card geometry - the arithmetic that decides whether a remembered card is
 * reachable or lost.
 *
 * The case that matters is not "the numbers are clamped". It is that a card can be dragged
 * *back*. A card is dragged by its own header, so a clamp that keeps the card's bottom-right
 * corner on screen while its header sits above the top edge has satisfied its own assertion
 * and still left the user with no way to move the thing. Every test below is written against
 * reachability rather than against containment, because those are different properties and
 * only one of them is the feature.
 *
 * Tested without a window on purpose: `floatingLayout.ts` imports nothing, which is the only
 * reason these run in milliseconds.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  KEEP_VISIBLE,
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  centreIn,
  clampSize,
  clampToViewport,
  parsePoint,
  parseSize,
} from "../src/renderer/workbench/floatingLayout.ts";

const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 520, height: 380 };

describe("clampToViewport", () => {
  it("leaves a position that is already comfortably inside alone", () => {
    expect(clampToViewport({ x: 300, y: 200 }, CARD, VIEWPORT)).toEqual({ x: 300, y: 200 });
  });

  it("never allows the header above the top edge", () => {
    // The regression that motivates the whole module: a negative y puts the drag handle
    // off-screen, and the card can then never be moved by any means the UI offers.
    expect(clampToViewport({ x: 100, y: -400 }, CARD, VIEWPORT).y).toBe(0);
  });

  it("pulls back a card remembered beyond the right edge on a narrower window", () => {
    // Written on a 2560px monitor, reopened on a 1440px one.
    const position = clampToViewport({ x: 2200, y: 100 }, CARD, VIEWPORT);
    expect(position.x).toBe(VIEWPORT.width - KEEP_VISIBLE);
  });

  it("allows a card to hang off the left edge, but not to vanish through it", () => {
    const position = clampToViewport({ x: -5000, y: 100 }, CARD, VIEWPORT);
    expect(position.x).toBe(KEEP_VISIBLE - CARD.width);
    // Which is to say: exactly KEEP_VISIBLE pixels of it remain grabbable.
    expect(position.x + CARD.width).toBe(KEEP_VISIBLE);
  });

  it("keeps a card reachable in a viewport smaller than the card itself", () => {
    // A 520×380 card in a 300×200 window. It cannot fit, so it necessarily overflows - the
    // property being defended is that its header stays on screen anyway.
    const tiny = { width: 300, height: 200 };
    const position = clampToViewport({ x: 500, y: 500 }, CARD, tiny);

    expect(position).toEqual({ x: tiny.width - KEEP_VISIBLE, y: tiny.height - KEEP_VISIBLE });
    expect(position.y).toBeLessThan(tiny.height);
    expect(position.x).toBeLessThan(tiny.width);
  });

  it("pins to the low edge when the clamp range inverts", () => {
    // The range only inverts once the viewport and the card together are narrower than two
    // margins - a 40px window. Degenerate, but it is reachable through a window animation
    // frame or a display disconnect, and `Math.min(high, Math.max(low, v))` with high < low
    // would return `high` and push the header off the left edge permanently.
    const position = clampToViewport({ x: 500, y: 500 }, { width: 50, height: 50 }, { width: 40, height: 30 });

    expect(position.x).toBe(KEEP_VISIBLE - 50);
    expect(position.y).toBe(0);
  });

  it("keeps every clamped card reachable, for any remembered position", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20_000, max: 20_000 }),
        fc.integer({ min: -20_000, max: 20_000 }),
        (x, y) => {
          const position = clampToViewport({ x, y }, CARD, VIEWPORT);

          // The header row is on screen, so there is something to drag.
          expect(position.y).toBeGreaterThanOrEqual(0);
          expect(position.y).toBeLessThanOrEqual(VIEWPORT.height - KEEP_VISIBLE);

          // And enough of that row is horizontally visible to put a pointer on.
          expect(position.x + CARD.width).toBeGreaterThanOrEqual(KEEP_VISIBLE);
          expect(position.x).toBeLessThanOrEqual(VIEWPORT.width - KEEP_VISIBLE);
        },
      ),
    );
  });
});

describe("clampSize", () => {
  it("holds a card to its floors", () => {
    const size = clampSize({ width: 10, height: 10 }, VIEWPORT);
    expect(size).toEqual({ width: MIN_FLOAT_WIDTH, height: MIN_FLOAT_HEIGHT });
  });

  it("does not let a remembered size exceed the window", () => {
    const size = clampSize({ width: 9000, height: 9000 }, VIEWPORT);
    expect(size).toEqual({ width: VIEWPORT.width, height: VIEWPORT.height });
  });

  it("prefers the floor over the viewport when the window is smaller than the floor", () => {
    // A window narrower than 320px is pathological, but the floor is what keeps the
    // toolbar from collapsing - so it wins, and the card overflows instead.
    const size = clampSize({ width: 400, height: 400 }, { width: 100, height: 100 });
    expect(size).toEqual({ width: MIN_FLOAT_WIDTH, height: MIN_FLOAT_HEIGHT });
  });
});

describe("centreIn", () => {
  it("centres horizontally and sits above the vertical centre", () => {
    const point = centreIn(CARD, VIEWPORT);

    expect(point.x).toBe(Math.round((VIEWPORT.width - CARD.width) / 2));
    // Above true centre, which would be (900 - 380) / 2 = 260.
    expect(point.y).toBeLessThan(260);
    expect(point.y).toBeGreaterThan(0);
  });

  it("returns a reachable point even in a viewport smaller than the card", () => {
    const point = centreIn(CARD, { width: 200, height: 150 });
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x + CARD.width).toBeGreaterThanOrEqual(KEEP_VISIBLE);
  });
});

describe("parsePoint and parseSize", () => {
  it("round-trips what was written", () => {
    expect(parsePoint(JSON.stringify({ x: 12, y: 34 }))).toEqual({ x: 12, y: 34 });
    expect(parseSize(JSON.stringify({ width: 12, height: 34 }))).toEqual({
      width: 12,
      height: 34,
    });
  });

  it("returns null for a missing key rather than a card at NaN", () => {
    expect(parsePoint(null)).toBeNull();
    expect(parseSize(null)).toBeNull();
  });

  it("rejects every shape a previous build or a devtools edit could have left behind", () => {
    for (const raw of [
      "",
      "not json",
      "null",
      "42",
      '"a string"',
      "[]",
      "{}",
      '{"x":1}',
      '{"x":"1","y":"2"}',
      '{"x":null,"y":null}',
    ]) {
      expect(parsePoint(raw)).toBeNull();
    }
  });

  it("rejects NaN and Infinity, which JSON.parse is happy to produce via strings", () => {
    // `NaN` would survive a naive `typeof === "number"` check and then poison the clamp,
    // placing the card at `translate(NaN, NaN)` - which renders nowhere at all.
    expect(parsePoint('{"x":1e999,"y":0}')).toBeNull();
    expect(parseSize('{"width":1e999,"height":1}')).toBeNull();
  });
});
