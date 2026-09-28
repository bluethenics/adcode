/**
 * The arithmetic behind "a box glides to its new column": measure where it was, measure where
 * it is, and animate the difference back to nothing. Pure, so the rules - ignore sub-pixel
 * noise, skip boxes that did not move, cap the stagger - are tested without a window.
 */
import { describe, expect, it } from "vitest";
import { flipDelta, motionPersonality, staggerIndex } from "../src/renderer/motionFlip.ts";

const rect = (left: number, top: number, width = 200, height = 80) => ({ left, top, width, height });

describe("flipDelta", () => {
  it("is the distance from the new place back to the old one", () => {
    expect(flipDelta(rect(10, 400), rect(250, 120))).toEqual({ dx: -240, dy: 280 });
  });

  it("ignores a box that did not move, or moved less than a pixel", () => {
    expect(flipDelta(rect(10, 10), rect(10, 10))).toBeNull();
    expect(flipDelta(rect(10, 10), rect(10.4, 9.6))).toBeNull();
  });

  it("does not animate from a box that was not on screen", () => {
    expect(flipDelta(rect(0, 0, 0, 0), rect(100, 100))).toBeNull();
    expect(flipDelta(rect(100, 100), rect(0, 0, 0, 0))).toBeNull();
  });
});

describe("staggerIndex", () => {
  it("delays each list item a little more, up to a cap", () => {
    expect(staggerIndex(0)).toBe(0);
    expect(staggerIndex(5)).toBe(5);
    expect(staggerIndex(12)).toBe(12);
    expect(staggerIndex(400)).toBe(12);
    expect(staggerIndex(-3)).toBe(0);
  });
});

describe("motionPersonality", () => {
  it("is lively in Vibe and crisp in Code", () => {
    expect(motionPersonality("vibe")).toBe("lively");
    expect(motionPersonality("code")).toBe("crisp");
  });
});
