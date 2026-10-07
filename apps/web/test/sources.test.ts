import { describe, expect, it } from "vitest";
import { coverageText, sourceCells, SOURCE_COLUMNS, windowLabel, type SourceRowView } from "@/lib/sources";

const row = (overrides: Partial<SourceRowView> = {}): SourceRowView => ({
  key: "users",
  kind: "users",
  code: null,
  label: "Invites from users",
  visits: 4,
  people: 3,
  realUsers: 2,
  cameBack: 1,
  adRevenueMicros: "8000",
  advertisers: 1,
  advertiserSpendMicros: "16000",
  paidMicros: "1600",
  keptMicros: "10400",
  ...overrides,
});

describe("a Sources row on screen", () => {
  it("has one cell per column, money exact, and a dash where there is no page to visit", () => {
    expect(SOURCE_COLUMNS).toHaveLength(10);
    expect(sourceCells(row())).toEqual(["Invites from users", "4", "3", "2", "1", "$0.008000", "1", "$0.016000", "$0.001600", "$0.010400"]);
    expect(sourceCells(row({ key: "unknown", kind: "unknown", label: "Unknown", visits: null }))[1]).toBe("—");
  });

  it("names a campaign code by its label, with the code beside it", () => {
    expect(sourceCells(row({ key: "campaign:threads-oct06", kind: "campaign", code: "threads-oct06", label: "Threads post" }))[0])
      .toBe("Threads post (threads-oct06)");
    expect(sourceCells(row({ key: "campaign:x-ad-3", kind: "campaign", code: "x-ad-3", label: "" }))[0]).toBe("x-ad-3");
  });
});

describe("attribution coverage", () => {
  it("says what share of new real users came with any code", () => {
    expect(coverageText({ attributedRealUsers: 16, realUsers: 25 })).toBe("64% of new real users came with a code (16 of 25).");
    expect(coverageText({ attributedRealUsers: 0, realUsers: 0 })).toBe("No new real users in this window yet.");
  });
});

describe("the window", () => {
  it("reads as words", () => {
    expect(windowLabel(7)).toBe("Last 7 days");
    expect(windowLabel(0)).toBe("All time");
  });
});
