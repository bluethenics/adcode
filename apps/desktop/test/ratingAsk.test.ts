import { describe, expect, it } from "vitest";
import { STORE_REVIEW_URL, recordActiveDay, shouldAskForRating } from "../src/shared/ratingAsk.ts";

const ready = { fromStore: true, activeDays: ["2026-10-01", "2026-10-03", "2026-10-07"], firstValueAt: 1, asked: false };

describe("asking for a Store rating", () => {
  it("asks a Store install that has built something and come back on three days", () => {
    expect(shouldAskForRating(ready)).toBe(true);
  });

  it("never asks twice, never asks before ADCode has worked for them, never off the Store", () => {
    expect(shouldAskForRating({ ...ready, asked: true })).toBe(false);
    expect(shouldAskForRating({ ...ready, firstValueAt: null })).toBe(false);
    expect(shouldAskForRating({ ...ready, fromStore: false })).toBe(false);
    expect(shouldAskForRating({ ...ready, activeDays: ["2026-10-01", "2026-10-03"] })).toBe(false);
  });

  it("opens the Store's own review page for ADCode", () => {
    expect(STORE_REVIEW_URL).toBe("ms-windows-store://review/?ProductId=9MSW2N027GJX");
  });
});

describe("the days ADCode was used", () => {
  it("counts a day once and keeps the last ten", () => {
    expect(recordActiveDay(["2026-10-01"], "2026-10-01")).toEqual(["2026-10-01"]);
    expect(recordActiveDay(["2026-10-01"], "2026-10-02")).toEqual(["2026-10-01", "2026-10-02"]);
    const many = Array.from({ length: 10 }, (_, i) => `2026-09-${String(10 + i).padStart(2, "0")}`);
    expect(recordActiveDay(many, "2026-10-01")).toHaveLength(10);
    expect(recordActiveDay(many, "2026-10-01").at(-1)).toBe("2026-10-01");
  });
});
