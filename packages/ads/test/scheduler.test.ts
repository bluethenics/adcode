import { describe, it, expect } from "vitest";
import { decide, tightenCaps } from "../src/scheduler.ts";
import { PRESETS, SETTLE_MS, type SchedulerState } from "../src/types.ts";

const NOW = 1_700_000_000_000;

/** A state in which nothing suppresses: `decide` must return `{ show: true }`. */
const clear: SchedulerState = {
  now: NOW,
  adsEnabled: true,
  killSwitch: false,
  preset: "standard",
  caps: PRESETS.standard,
  launchedAt: NOW - SETTLE_MS - 1,
  settleMs: SETTLE_MS,
  windowFocused: true,
  debugActive: false,
  doNotDisturb: false,
  impressionsToday: 0,
  lastImpressionAt: null,
  creativeAvailable: true,
};

describe("decide - the clear case", () => {
  it("shows when nothing suppresses", () => {
    expect(decide(clear)).toEqual({ show: true });
  });
});

describe("decide - one reason at a time", () => {
  const cases: ReadonlyArray<[string, Partial<SchedulerState>]> = [
    ["ads-disabled", { adsEnabled: false }],
    ["kill-switch", { killSwitch: true }],
    ["frequency-off", { preset: "off" }],
    ["settling", { launchedAt: NOW - 1 }],
    ["window-unfocused", { windowFocused: false }],
    ["debug-active", { debugActive: true }],
    ["do-not-disturb", { doNotDisturb: true }],
    ["daily-cap", { impressionsToday: PRESETS.standard.dailyCap }],
    ["min-interval", { lastImpressionAt: NOW - 1 }],
    ["no-creative", { creativeAvailable: false }],
  ];

  for (const [reason, patch] of cases) {
    it(`returns ${reason}`, () => {
      expect(decide({ ...clear, ...patch })).toEqual({ show: false, reason });
    });
  }
});

describe("decide - precedence", () => {
  // §8.1: user intent first, then context, then rate limits, then inventory - so the
  // reason returned stays meaningful as telemetry.
  it("prefers ads-disabled over everything downstream", () => {
    expect(
      decide({ ...clear, adsEnabled: false, killSwitch: true, windowFocused: false, creativeAvailable: false }),
    ).toEqual({ show: false, reason: "ads-disabled" });
  });

  it("prefers kill-switch over context and rate limits", () => {
    expect(
      decide({ ...clear, killSwitch: true, debugActive: true, impressionsToday: 99 }),
    ).toEqual({ show: false, reason: "kill-switch" });
  });

  it("prefers frequency-off over settling", () => {
    expect(decide({ ...clear, preset: "off", launchedAt: NOW - 1 })).toEqual({
      show: false,
      reason: "frequency-off",
    });
  });

  it("prefers do-not-disturb over daily-cap", () => {
    expect(decide({ ...clear, doNotDisturb: true, impressionsToday: 99 })).toEqual({
      show: false,
      reason: "do-not-disturb",
    });
  });

  it("prefers daily-cap over min-interval", () => {
    expect(
      decide({ ...clear, impressionsToday: 99, lastImpressionAt: NOW - 1 }),
    ).toEqual({ show: false, reason: "daily-cap" });
  });

  it("prefers min-interval over no-creative", () => {
    expect(
      decide({ ...clear, lastImpressionAt: NOW - 1, creativeAvailable: false }),
    ).toEqual({ show: false, reason: "min-interval" });
  });
});

describe("decide - boundaries", () => {
  it("settles for exactly settleMs, then shows", () => {
    expect(decide({ ...clear, launchedAt: NOW - SETTLE_MS + 1 })).toEqual({
      show: false,
      reason: "settling",
    });
    expect(decide({ ...clear, launchedAt: NOW - SETTLE_MS })).toEqual({ show: true });
  });

  it("blocks at exactly the daily cap, allows one below", () => {
    // Read from the preset rather than written out: the assertion is about the boundary,
    // and hard-coding the number means every cadence change breaks a scheduler test that
    // has nothing to do with cadence.
    const cap = clear.caps.dailyCap;
    expect(decide({ ...clear, impressionsToday: cap })).toEqual({ show: false, reason: "daily-cap" });
    expect(decide({ ...clear, impressionsToday: cap - 1 })).toEqual({ show: true });
  });

  it("blocks one ms inside the interval, allows exactly at it", () => {
    const gap = PRESETS.standard.minIntervalMs;
    expect(decide({ ...clear, lastImpressionAt: NOW - gap + 1 })).toEqual({
      show: false,
      reason: "min-interval",
    });
    expect(decide({ ...clear, lastImpressionAt: NOW - gap })).toEqual({ show: true });
  });
});

describe("tightenCaps", () => {
  const local = PRESETS.standard; // 1_800_000 / 8

  it("takes the stricter of each value", () => {
    expect(tightenCaps(local, { minIntervalMs: 3_600_000, dailyCap: 4 })).toEqual({
      minIntervalMs: 3_600_000,
      dailyCap: 4,
    });
  });

  it("never loosens - a looser remote leaves local standing", () => {
    expect(tightenCaps(local, { minIntervalMs: 1_000, dailyCap: 500 })).toEqual(local);
  });

  it("tightens each field independently", () => {
    // A longer remote interval wins; a looser remote cap does not.
    const longer = local.minIntervalMs * 2;
    expect(tightenCaps(local, { minIntervalMs: longer, dailyCap: 500 })).toEqual({
      minIntervalMs: longer,
      dailyCap: local.dailyCap,
    });
  });

  it("discards hostile input rather than widening", () => {
    // §1: "A compromised or misconfigured server must not be able to make the IDE
    // more annoying than its shipped defaults."
    for (const hostile of [
      { minIntervalMs: -1 },
      { dailyCap: -1 },
      { minIntervalMs: Number.NaN },
      { dailyCap: Number.NaN },
      { minIntervalMs: Number.POSITIVE_INFINITY },
      { minIntervalMs: Number.NEGATIVE_INFINITY },
      { dailyCap: Number.POSITIVE_INFINITY },
      { minIntervalMs: "9999" as unknown as number },
      { dailyCap: null as unknown as number },
      { dailyCap: undefined },
    ]) {
      expect(tightenCaps(local, hostile), JSON.stringify(hostile)).toEqual(local);
    }
  });

  it("accepts a remote zero cap - that is tightening, not hostile", () => {
    expect(tightenCaps(local, { dailyCap: 0 })).toEqual({
      minIntervalMs: local.minIntervalMs,
      dailyCap: 0,
    });
  });

  it("is unchanged by an empty remote config", () => {
    expect(tightenCaps(local, {})).toEqual(local);
  });
});

/*
 * A test card skips pacing, never restraint.
 *
 * The distinction is the whole point. Everything above the rate limits in `decide` is a
 * promise about not interrupting people, and an admin proving delivery works has no
 * business overriding it. The two rate limits are only about how often it is *polite* to
 * interrupt, and waiting ten minutes for a test means the person who asked has already
 * concluded delivery is broken.
 */
describe("decide - an admin test card", () => {
  const testing = { ...clear, testCardWaiting: true };

  it("shows even at the daily cap", () => {
    expect(decide({ ...testing, impressionsToday: testing.caps.dailyCap + 5 })).toEqual({
      show: true,
    });
  });

  it("shows even one millisecond into the minimum gap", () => {
    expect(decide({ ...testing, lastImpressionAt: NOW - 1 })).toEqual({ show: true });
  });

  it("still refuses while somebody is typing, debugging, or away", () => {
    // Restraint. A test card is not a licence to interrupt.
    expect(decide({ ...testing, windowFocused: false })).toEqual({
      show: false,
      reason: "window-unfocused",
    });
    expect(decide({ ...testing, debugActive: true })).toEqual({
      show: false,
      reason: "debug-active",
    });
    expect(decide({ ...testing, doNotDisturb: true })).toEqual({
      show: false,
      reason: "do-not-disturb",
    });
  });

  it("still respects the user having switched ads off", () => {
    // An admin must not be able to put a card in front of somebody who declined them.
    expect(decide({ ...testing, adsEnabled: false })).toEqual({
      show: false,
      reason: "ads-disabled",
    });
    expect(decide({ ...testing, preset: "off" })).toEqual({ show: false, reason: "frequency-off" });
    expect(decide({ ...testing, killSwitch: true })).toEqual({ show: false, reason: "kill-switch" });
  });

  it("still waits out the settle period after launch", () => {
    expect(decide({ ...testing, launchedAt: NOW })).toEqual({ show: false, reason: "settling" });
  });

  it("leaves the ordinary path alone when the flag is absent or false", () => {
    const capped = { ...clear, impressionsToday: clear.caps.dailyCap };
    expect(decide(capped)).toEqual({ show: false, reason: "daily-cap" });
    expect(decide({ ...capped, testCardWaiting: false })).toEqual({ show: false, reason: "daily-cap" });
  });
});
