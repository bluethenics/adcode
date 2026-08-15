import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decide, tightenCaps } from "../src/scheduler.ts";
import { PRESETS, SETTLE_MS, type FrequencyCaps, type SchedulerState } from "../src/types.ts";

/**
 * Brief §11: "no sequence of events can exceed the daily cap or violate the minimum
 * interval. This is the behavior users judge the product on, so it carries the
 * strongest guarantee in the codebase."
 *
 * The property is asserted through a simulator rather than against `decide` directly.
 * `decide` is a pure function of a state someone else assembles, so testing it alone
 * would prove only that it reads its arguments correctly. The invariant users actually
 * care about spans the scheduler *and* the host that tracks impressions across day
 * boundaries, so the simulator plays the host and the property covers the pair.
 */

const DAY_MS = 86_400_000;
const START = 1_700_000_000_000;

type Event =
  | { kind: "advance"; ms: number }
  | { kind: "focus"; value: boolean }
  | { kind: "attempt" };

class Simulator {
  now = START;
  focused = true;
  readonly impressions: number[] = [];
  readonly caps: FrequencyCaps;

  constructor(caps: FrequencyCaps) {
    this.caps = caps;
  }

  private state(): SchedulerState {
    const today = Math.floor(this.now / DAY_MS);
    return {
      now: this.now,
      adsEnabled: true,
      killSwitch: false,
      preset: "standard",
      caps: this.caps,
      launchedAt: START - SETTLE_MS,
      settleMs: SETTLE_MS,
      windowFocused: this.focused,
      debugActive: false,
      doNotDisturb: false,
      impressionsToday: this.impressions.filter((t) => Math.floor(t / DAY_MS) === today).length,
      lastImpressionAt: this.impressions.at(-1) ?? null,
      creativeAvailable: true,
    };
  }

  step(event: Event): void {
    if (event.kind === "advance") this.now += event.ms;
    else if (event.kind === "focus") this.focused = event.value;
    else if (decide(this.state()).show) this.impressions.push(this.now);
  }

  maxImpressionsInAnyDay(): number {
    const perDay = new Map<number, number>();
    for (const t of this.impressions) {
      const day = Math.floor(t / DAY_MS);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    return perDay.size === 0 ? 0 : Math.max(...perDay.values());
  }

  minGapBetweenImpressions(): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 1; i < this.impressions.length; i++) {
      min = Math.min(min, this.impressions[i]! - this.impressions[i - 1]!);
    }
    return min;
  }
}

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  fc.record({ kind: fc.constant("advance" as const), ms: fc.integer({ min: 0, max: 3 * DAY_MS }) }),
  fc.record({ kind: fc.constant("focus" as const), value: fc.boolean() }),
  fc.record({ kind: fc.constant("attempt" as const) }),
  // Attempts are what stress the caps, so weight them heavily.
  fc.record({ kind: fc.constant("attempt" as const) }),
  fc.record({ kind: fc.constant("attempt" as const) }),
);

describe("scheduler invariants", () => {
  it("no sequence of events can exceed the daily cap or violate the minimum interval", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 400 }), (events) => {
        const sim = new Simulator(PRESETS.standard);
        for (const event of events) sim.step(event);

        expect(sim.maxImpressionsInAnyDay()).toBeLessThanOrEqual(PRESETS.standard.dailyCap);
        expect(sim.minGapBetweenImpressions()).toBeGreaterThanOrEqual(PRESETS.standard.minIntervalMs);
      }),
      { numRuns: 500 },
    );
  });

  it("holds for every preset", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("light" as const, "standard" as const, "max" as const),
        fc.array(eventArb, { maxLength: 200 }),
        (preset, events) => {
          const caps = PRESETS[preset];
          const sim = new Simulator(caps);
          for (const event of events) sim.step(event);

          expect(sim.maxImpressionsInAnyDay()).toBeLessThanOrEqual(caps.dailyCap);
          expect(sim.minGapBetweenImpressions()).toBeGreaterThanOrEqual(caps.minIntervalMs);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/** Hostile remote values: the shapes a compromised or misconfigured server could send. */
const hostileNumber = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    -999_999,
    Number.MAX_SAFE_INTEGER,
  ),
  fc.string() as unknown as fc.Arbitrary<number>,
  fc.constantFrom(null, undefined, {}, []) as unknown as fc.Arbitrary<number>,
);

describe("tightenCaps invariants", () => {
  it("never loosens the local caps, for arbitrary hostile remote input", () => {
    // Spec deviation D7: the enforceable invariant is that remote config may only
    // tighten the user's *current effective* caps.
    fc.assert(
      fc.property(
        fc.record({
          minIntervalMs: fc.integer({ min: 0, max: 7_200_000 }),
          dailyCap: fc.integer({ min: 0, max: 100 }),
        }),
        fc.record({ minIntervalMs: hostileNumber, dailyCap: hostileNumber }, { requiredKeys: [] }),
        (local, remote) => {
          const out = tightenCaps(local, remote);

          expect(out.minIntervalMs).toBeGreaterThanOrEqual(local.minIntervalMs);
          expect(out.dailyCap).toBeLessThanOrEqual(local.dailyCap);
          expect(Number.isFinite(out.minIntervalMs)).toBe(true);
          expect(Number.isInteger(out.dailyCap)).toBe(true);
          expect(out.dailyCap).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
