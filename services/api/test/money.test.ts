import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseMicros,
  formatMicros,
  advertiserCostMicros,
  userCreditMicros,
  INT64_MAX,
  INT64_MIN,
} from "../src/money.ts";

describe("parseMicros", () => {
  it("accepts a plain decimal integer string", () => {
    expect(parseMicros("1250")).toBe(1250n);
    expect(parseMicros("-1250")).toBe(-1250n);
    expect(parseMicros("0")).toBe(0n);
  });

  it("rejects anything that is not a decimal integer string", () => {
    for (const bad of ["", " 1", "1 ", "1.5", "1e3", "0x10", "+1", "--1", "abc", "1,000"]) {
      expect(parseMicros(bad)).toBeNull();
    }
  });

  it("rejects values outside int64, which the client would reject too", () => {
    expect(parseMicros((INT64_MAX + 1n).toString())).toBeNull();
    expect(parseMicros((INT64_MIN - 1n).toString())).toBeNull();
    expect(parseMicros(INT64_MAX.toString())).toBe(INT64_MAX);
    expect(parseMicros(INT64_MIN.toString())).toBe(INT64_MIN);
  });
});

describe("formatMicros round-trips", () => {
  it("survives any in-range value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: INT64_MIN, max: INT64_MAX }), (v) => {
        expect(parseMicros(formatMicros(v))).toBe(v);
      }),
    );
  });
});

describe("credit computation", () => {
  // Spec §8.1: CPM is cost per mille; revSharePercent is a percentage.
  it("splits an $8 CPM at 50% into 8000 micros of cost and 4000 of credit", () => {
    const cost = advertiserCostMicros(8_000_000n);
    expect(cost).toBe(8000n);
    expect(userCreditMicros(cost, 50n)).toBe(4000n);
  });

  it("truncates rather than rounding, deterministically", () => {
    // 999 micros CPM / 1000 truncates to 0 - the house keeps the fraction.
    expect(advertiserCostMicros(999n)).toBe(0n);
    expect(userCreditMicros(3n, 50n)).toBe(1n);
  });

  it("never credits more than the advertiser was charged", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 100n }),
        (cpm, share) => {
          const cost = advertiserCostMicros(cpm);
          expect(userCreditMicros(cost, share) <= cost).toBe(true);
        },
      ),
    );
  });
});
