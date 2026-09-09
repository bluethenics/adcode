import { describe, expect, it } from "vitest";
import { DEMO_COUNT_START, formatCount } from "../src/lib/heroStats";

describe("hero counter formatting", () => {
  it("starts the illustrative counter at 140,345", () => {
    expect(formatCount(DEMO_COUNT_START)).toBe("140,345");
  });

  it("keeps digit carries and thousands separators readable", () => {
    expect(formatCount(140_349 + 1)).toBe("140,350");
    expect(formatCount(999_999 + 1)).toBe("1,000,000");
  });

  it("renders only finite, non-negative whole numbers", () => {
    expect(formatCount(140_345.7)).toBe("140,345");
    for (const invalid of [-1, NaN, Infinity]) expect(formatCount(invalid)).toBe("0");
  });
});
