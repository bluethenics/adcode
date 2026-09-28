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
  resizeGeometry,
  bottomRightIn,
  maximisedIn,
  FLOATING_SHEET_BREAKPOINT,
  fitInViewport,
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

/*
 * Floating panels resize from every edge, not only a corner. A west or north drag moves the
 * panel's origin as well as its size, and that pair is where an off-by-dx bug hides: the
 * right edge must stay exactly where it was while the left edge follows the pointer.
 */
describe("resizeGeometry", () => {
  const start = { position: { x: 400, y: 200 }, size: { width: 500, height: 400 } };

  it("grows east without moving the origin", () => {
    expect(resizeGeometry(start, "e", 60, 0, VIEWPORT)).toEqual({ position: { x: 400, y: 200 }, size: { width: 560, height: 400 } });
  });

  it("drags the west edge while the east edge stays put", () => {
    const next = resizeGeometry(start, "w", -40, 0, VIEWPORT);
    expect(next.position.x).toBe(360);
    expect(next.position.x + next.size.width).toBe(900);
  });

  it("stops the west edge at the minimum width instead of pushing the panel right", () => {
    const next = resizeGeometry(start, "w", 400, 0, VIEWPORT);
    expect(next.size.width).toBe(MIN_FLOAT_WIDTH);
    expect(next.position.x + next.size.width).toBe(900);
  });

  it("never lets the north edge rise above the window, where the header is unreachable", () => {
    const next = resizeGeometry(start, "n", 0, -500, VIEWPORT);
    expect(next.position.y).toBe(0);
    expect(next.position.y + next.size.height).toBe(600);
  });

  it("grows both axes from the south-east corner", () => {
    expect(resizeGeometry(start, "se", 20, 30, VIEWPORT).size).toEqual({ width: 520, height: 430 });
  });

  it("never grows past the viewport", () => {
    const next = resizeGeometry(start, "se", 5_000, 5_000, VIEWPORT);
    expect(next.size.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(next.size.height).toBeLessThanOrEqual(VIEWPORT.height);
  });
});

describe("panel placement", () => {
  it("parks a new panel at the bottom-right with a margin", () => {
    expect(bottomRightIn({ width: 420, height: 560 }, { width: 1400, height: 900 })).toEqual({ x: 964, y: 324 });
  });

  it("keeps a bottom-right panel reachable in a window smaller than it", () => {
    const point = bottomRightIn({ width: 420, height: 560 }, { width: 300, height: 200 });
    expect(point.y).toBeGreaterThanOrEqual(0);
  });

  it("maximises inside a margin", () => {
    expect(maximisedIn({ width: 1000, height: 700 })).toEqual({ position: { x: 12, y: 12 }, size: { width: 976, height: 676 } });
  });

  it("turns panels into sheets below the narrow-window breakpoint", () => {
    expect(FLOATING_SHEET_BREAKPOINT).toBe(820);
  });
});

/*
 * A drag may park a panel half off the edge on purpose. A window that shrank under it did not
 * ask for that: when the panel fits, opening it or resizing the window brings all of it back.
 */
describe("fitInViewport", () => {
  it("pulls a panel that fits fully back on screen", () => {
    expect(fitInViewport({ x: 844, y: 224 }, { width: 420, height: 560 }, { width: 900, height: 800 })).toEqual({ x: 480, y: 224 });
  });

  it("leaves a panel that is already inside where it is", () => {
    expect(fitInViewport({ x: 20, y: 30 }, { width: 400, height: 300 }, { width: 900, height: 800 })).toEqual({ x: 20, y: 30 });
  });

  it("falls back to keeping the header reachable when the panel is bigger than the window", () => {
    const point = fitInViewport({ x: 500, y: 500 }, { width: 1200, height: 900 }, { width: 900, height: 700 });
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(700 - KEEP_VISIBLE);
    expect(point.x).toBeLessThanOrEqual(900 - KEEP_VISIBLE);
  });
});
