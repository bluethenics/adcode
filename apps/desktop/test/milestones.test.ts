import { describe, expect, it } from "vitest";
import { MILESTONES, NEWCOMER_HOLD_MS, isMilestone, newcomerHold } from "../src/shared/milestones.ts";

const NOW = 1_800_000_000_000;

describe("the newcomer hold on ads", () => {
  it("holds a new install before its first success", () => {
    expect(newcomerHold({ firstLaunchAt: NOW - 60_000, firstValueAt: null }, NOW)).toBe(true);
  });

  it("lets go the moment something works", () => {
    expect(newcomerHold({ firstLaunchAt: NOW - 60_000, firstValueAt: NOW - 1 }, NOW)).toBe(false);
  });

  it("lets go after a quarter of an hour, so hand-coders still see the cards that pay for it", () => {
    expect(newcomerHold({ firstLaunchAt: NOW - NEWCOMER_HOLD_MS, firstValueAt: null }, NOW)).toBe(false);
  });
});

describe("milestone names", () => {
  it("accepts only the fixed words", () => {
    for (const name of MILESTONES) expect(isMilestone(name)).toBe(true);
    expect(isMilestone("prompt: build a bank")).toBe(false);
    expect(isMilestone(42)).toBe(false);
  });
});
