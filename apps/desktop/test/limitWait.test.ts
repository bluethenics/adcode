import { describe, expect, it } from "vitest";
import { limitWaitCountdown, limitWaitHeadline } from "../src/renderer/ai/limitWait.ts";

/**
 * The card a chat shows while it waits out a usage limit - asked for "like Claude": what
 * happened, when it resets, and that it will carry on by itself.
 */
const at = (hours: number, minutes: number) => new Date(2026, 9, 9, hours, minutes).getTime();

describe("limitWaitHeadline", () => {
  it("says the limit is reached, when it resets, and that it continues", () => {
    const text = limitWaitHeadline("Tag Flow AI", at(15, 0), at(10, 0));
    expect(text).toMatch(/^Tag Flow AI usage limit reached · resets at /);
    expect(text).toMatch(/3:00|15:00/);
    expect(text).toMatch(/continuing automatically$/);
  });

  it("names the day when the reset is not today", () => {
    expect(limitWaitHeadline("Tag Flow AI", at(15, 0) + 86_400_000, at(10, 0))).toMatch(/Sat|Oct 10|10 Oct/);
  });
});

describe("limitWaitCountdown", () => {
  it.each([
    [at(10, 0), at(15, 0), "Continuing in 5h 0m"],
    [at(10, 0), at(10, 42) + 30_000, "Continuing in 42m 30s"],
    [at(10, 0), at(10, 0) + 9_000, "Continuing in 9s"],
    [at(10, 0), at(10, 0), "Continuing now…"],
    [at(10, 1), at(10, 0), "Continuing now…"],
  ])("from %s to %s reads %s", (now, resetsAt, text) => {
    expect(limitWaitCountdown(resetsAt, now)).toBe(text);
  });
});
