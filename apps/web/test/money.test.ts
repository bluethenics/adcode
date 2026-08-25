import { describe, it, expect } from "vitest";
import { money, moneyExact, moneyProgress } from "../src/components/money";

/*
 * `moneyProgress` exists because two decimals is wrong for most of what this product
 * pays out. A verified view credits 4,000 micros, so a new user's first earnings - and
 * often their first week - round to `$0.00`, which reads as "you have earned nothing"
 * rather than as "this has been rounded".
 */
describe("moneyProgress", () => {
  it("uses the familiar form once there is at least a cent", () => {
    expect(moneyProgress("10000")).toBe("$0.01");
    expect(moneyProgress("1234560")).toBe("$1.23");
    expect(moneyProgress("100000000")).toBe("$100.00");
  });

  it("shows the real figure below a cent instead of zero", () => {
    expect(moneyProgress("4000")).toBe("$0.004");
    expect(moneyProgress("34")).toBe("$0.000034");
    expect(moneyProgress("2")).toBe("$0.000002");
    expect(moneyProgress("9999")).toBe("$0.009999");
  });

  it("trims trailing zeros but never below two places", () => {
    // "$0.004000" is the same number as "$0.004" and harder to read; "$0.01" is the
    // same number as "$0.010000" and is what people expect to see.
    expect(moneyProgress("4000")).toBe("$0.004");
    expect(moneyProgress("100")).toBe("$0.0001");
    expect(moneyProgress("500000")).toBe("$0.50");
  });

  it("says $0.00 for nothing, rather than $0.000000", () => {
    // Zero is the one case where the padded form adds no information at all.
    expect(moneyProgress("0")).toBe("$0.00");
    expect(moneyProgress("")).toBe("$0.00");
  });

  it("keeps the sign on a correction", () => {
    expect(moneyProgress("-34")).toBe("-$0.000034");
    expect(moneyProgress("-2000000")).toBe("-$2.00");
  });

  it("never rounds up", () => {
    // A displayed balance must never be larger than the balance actually is: the
    // direction of the error matters when the number is money owed.
    expect(moneyProgress("19999")).toBe("$0.01");
    expect(moneyProgress("9999")).toBe("$0.009999");
  });

  it("is exact on a value no double could hold", () => {
    // The whole reason micros travel as strings. `Number("9007199254740993")` is 992.
    expect(moneyProgress("9007199254740993")).toBe("$9,007,199,254.74");
  });
});

describe("the formatters agree with each other", () => {
  it("matches `money` wherever `money` is not lying", () => {
    for (const value of ["10000", "250000", "1000000", "123456789"]) {
      expect(moneyProgress(value)).toBe(money(value));
    }
  });

  it("names the same number as `moneyExact`, more briefly", () => {
    // Same value, fewer characters: "$0.004000" and "$0.004" are the same money.
    expect(moneyExact("4000")).toBe("$0.004000");
    expect(moneyProgress("4000")).toBe("$0.004");
  });
});
