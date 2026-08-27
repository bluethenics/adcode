import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyServerBalance, formatMicros, formatMicrosCompact } from "../src/ledger.ts";
import { micros, type Balance } from "../src/types.ts";

describe("formatMicros", () => {
  it("formats whole dollars", () => {
    expect(formatMicros(micros(0n))).toBe("$0.00");
    expect(formatMicros(micros(1_000_000n))).toBe("$1.00");
    expect(formatMicros(micros(42_000_000n))).toBe("$42.00");
  });

  it("formats cents", () => {
    expect(formatMicros(micros(2_500_000n))).toBe("$2.50");
    expect(formatMicros(micros(990_000n))).toBe("$0.99");
    expect(formatMicros(micros(10_000n))).toBe("$0.01");
  });

  it("shows sub-cent precision rather than rounding it away", () => {
    // A per-impression payout can easily be worth less than a cent; rounding it to
    // $0.00 in the UI would make the product look broken.
    expect(formatMicros(micros(1n))).toBe("$0.000001");
    expect(formatMicros(micros(1_500n))).toBe("$0.0015");
    expect(formatMicros(micros(123_456n))).toBe("$0.123456");
  });

  it("groups thousands", () => {
    expect(formatMicros(micros(1_234_567_000_000n))).toBe("$1,234,567.00");
    expect(formatMicros(micros(1_000_000_000n))).toBe("$1,000.00");
  });

  it("formats negatives with the sign outside the symbol", () => {
    expect(formatMicros(micros(-2_500_000n))).toBe("-$2.50");
    expect(formatMicros(micros(-1n))).toBe("-$0.000001");
  });

  it("holds precision at values a double cannot represent", () => {
    // 2^53 + 1. As a JS number this is indistinguishable from 2^53, which is exactly
    // the drift brief section 1 forbids in a revenue-share ledger.
    expect(formatMicros(micros(9_007_199_254_740_993n))).toBe("$9,007,199,254.740993");
    expect(formatMicros(micros(9_223_372_036_854_775_807n))).toBe("$9,223,372,036,854.775807");
  });

  it("never emits a floating-point artifact", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), (value) => {
        const out = formatMicros(micros(value));
        expect(out).not.toMatch(/e[+-]/i);
        expect(out).not.toMatch(/NaN|Infinity/);
        expect(out).toMatch(/^-?\$[0-9,]+\.[0-9]{2,6}$/);
      }),
      { numRuns: 1000 },
    );
  });

  it("round-trips through the display format", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (value) => {
        const digits = formatMicros(micros(value)).replace(/[$,]/g, "");
        const [whole, fraction = ""] = digits.split(".");
        const restored = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
        expect(restored).toBe(value);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("formatMicrosCompact", () => {
  it("drops the sub-cent tail for dense surfaces like the status bar", () => {
    expect(formatMicrosCompact(micros(123_456n))).toBe("$0.12");
    expect(formatMicrosCompact(micros(1_999_999n))).toBe("$1.99");
    expect(formatMicrosCompact(micros(0n))).toBe("$0.00");
  });

  it("truncates rather than rounds, so a balance never reads higher than it is", () => {
    expect(formatMicrosCompact(micros(1_999_999n))).not.toBe("$2.00");
    expect(formatMicrosCompact(micros(-1_999_999n))).toBe("-$1.99");
  });
});

describe("applyServerBalance", () => {
  const balance = (available: bigint, lifetime: bigint): Balance => ({
    availableMicros: micros(available),
    lifetimeMicros: micros(lifetime),
  });

  it("mirrors the server value verbatim", () => {
    const next = balance(500n, 900n);
    expect(applyServerBalance(null, next)).toEqual(next);
    expect(applyServerBalance(balance(1n, 2n), next)).toEqual(next);
  });

  it("accepts a decrease - the server owns the balance, including after a payout", () => {
    // Brief section 1: the client never computes money. A cash-out lowers the available
    // figure, and the client's job is to mirror that, not to argue with it.
    expect(applyServerBalance(balance(900n, 900n), balance(0n, 900n))).toEqual(balance(0n, 900n));
  });
});
