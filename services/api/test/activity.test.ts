import { describe, it, expect, beforeEach } from "vitest";
import { readActivity, recordActivity } from "../src/activity.ts";
import { ACTIVITY_CEILINGS, parseActivity } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

/** 2026-08-24T12:00:00Z. Fixed, so "today" is the same day on every machine. */
const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);

let store: ReturnType<typeof createMemoryStore>;
const deps = () => ({ store, clock: { now: () => NOW } });

const FLUSH = {
  day: "2026-08-24",
  manualChars: 400,
  agentChars: 100,
  acceptedEdits: 3,
  rejectedEdits: 1,
  filesTouched: 5,
  activeMs: 60_000,
  sessions: 1,
};

beforeEach(() => {
  store = createMemoryStore();
});

describe("parseActivity", () => {
  it("accepts a well-formed flush", () => {
    expect(parseActivity(FLUSH)).toEqual(FLUSH);
  });

  it("rejects a day that is not a real date", () => {
    expect(parseActivity({ ...FLUSH, day: "2026-13-45" })).toBeNull();
    expect(parseActivity({ ...FLUSH, day: "24/08/2026" })).toBeNull();
  });

  it("rejects negative, fractional, and infinite counts", () => {
    expect(parseActivity({ ...FLUSH, manualChars: -1 })).toBeNull();
    expect(parseActivity({ ...FLUSH, manualChars: 1.5 })).toBeNull();
    expect(parseActivity({ ...FLUSH, activeMs: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseActivity({ ...FLUSH, sessions: Number.NaN })).toBeNull();
  });

  it("rejects a flush above the ceiling rather than clamping it", () => {
    // Clamping would leave a wrong number nobody investigates. Refusing the whole flush
    // loses one report and keeps every chart after it readable.
    expect(parseActivity({ ...FLUSH, activeMs: ACTIVITY_CEILINGS.activeMs + 1 })).toBeNull();
    expect(parseActivity({ ...FLUSH, manualChars: ACTIVITY_CEILINGS.chars + 1 })).toBeNull();
  });

  it("refuses anything that is not a record", () => {
    expect(parseActivity(null)).toBeNull();
    expect(parseActivity("2026-08-24")).toBeNull();
  });
});

describe("recordActivity", () => {
  it("adds a second flush to the first rather than replacing it", async () => {
    await recordActivity(deps(), "u-1", FLUSH);
    await recordActivity(deps(), "u-1", FLUSH);

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days).toHaveLength(1);
    expect(view.days[0]?.manualChars).toBe(800);
    expect(view.days[0]?.agentChars).toBe(200);
    expect(view.days[0]?.sessions).toBe(2);
  });

  it("takes the larger file count instead of summing it", async () => {
    // The client sends the day's distinct file count. A file edited in two flushes is
    // one file, and summing would report two.
    await recordActivity(deps(), "u-1", { ...FLUSH, filesTouched: 5 });
    await recordActivity(deps(), "u-1", { ...FLUSH, filesTouched: 3 });

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days[0]?.filesTouched).toBe(5);
  });

  it("keeps one user's activity out of another's", async () => {
    await recordActivity(deps(), "u-1", FLUSH);
    await recordActivity(deps(), "u-2", { ...FLUSH, manualChars: 9 });

    const mine = await readActivity(deps(), "u-1", 30);
    expect(mine.totals.manualChars).toBe(400);
  });

  it("clamps a day in the future back to today", async () => {
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2031-01-01" });

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days[0]?.day).toBe("2026-08-24");
  });

  it("clamps a day from long ago into the window", async () => {
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2019-04-02" });

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days[0]?.day).toBe("2026-08-17");
  });
});

describe("readActivity", () => {
  it("reports the agent's share of what was written", async () => {
    await recordActivity(deps(), "u-1", { ...FLUSH, manualChars: 750, agentChars: 250 });

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.totals.agentPercent).toBe(25);
  });

  it("says nothing rather than 0% when nothing has been written", async () => {
    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days).toEqual([]);
    expect(view.totals.agentPercent).toBeNull();
  });

  it("returns newest first", async () => {
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2026-08-22" });
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2026-08-24" });
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2026-08-23" });

    const view = await readActivity(deps(), "u-1", 30);
    expect(view.days.map((d) => d.day)).toEqual(["2026-08-24", "2026-08-23", "2026-08-22"]);
  });

  it("leaves days outside the window out of the totals", async () => {
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2026-08-24" });
    await recordActivity(deps(), "u-1", { ...FLUSH, day: "2026-08-20" });

    const view = await readActivity(deps(), "u-1", 2);
    expect(view.days.map((d) => d.day)).toEqual(["2026-08-24"]);
    expect(view.totals.manualChars).toBe(400);
  });
});
