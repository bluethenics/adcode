import { describe, it, expect } from "vitest";
import { createActivityLog, mergeDeltas, utcDay } from "../src/shared/activity.ts";

/** 2026-08-24T12:00:00Z. Fixed so "today" does not depend on where the test runs. */
const NOON = Date.UTC(2026, 7, 24, 12, 0, 0);

/** A clock the test drives by hand, because every number here is a function of time. */
function fakeClock(start = NOON) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

describe("utcDay", () => {
  it("is UTC, not local", () => {
    // 23:30 UTC is already tomorrow in Sydney and still yesterday in Los Angeles. The
    // server groups by UTC, so a client that used local time would put a day's work on
    // the wrong side of a chart for most of the planet.
    expect(utcDay(Date.UTC(2026, 7, 24, 23, 30))).toBe("2026-08-24");
  });
});

describe("createActivityLog", () => {
  it("has nothing to say before anything happens", () => {
    const log = createActivityLog(fakeClock().now);
    expect(log.pending()).toBe(false);
    expect(log.drain()).toEqual([]);
  });

  it("counts typed characters against today", () => {
    const clock = fakeClock();
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 12, path: "/w/a.ts" });
    log.add({ manualChars: 8, path: "/w/a.ts" });

    const [delta] = log.drain();
    expect(delta?.day).toBe("2026-08-24");
    expect(delta?.manualChars).toBe(20);
    expect(delta?.filesTouched).toBe(1);
  });

  it("counts distinct files, not edits", () => {
    const log = createActivityLog(fakeClock().now);

    log.add({ manualChars: 1, path: "/w/a.ts" });
    log.add({ manualChars: 1, path: "/w/b.ts" });
    log.add({ manualChars: 1, path: "/w/a.ts" });

    expect(log.drain()[0]?.filesTouched).toBe(2);
  });

  it("keeps reporting the same file count rather than resetting it", () => {
    // The server takes the larger of what it holds and what arrives. A log that cleared
    // its file set would report "1 file" on every flush and the day would end at one.
    const clock = fakeClock();
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 1, path: "/w/a.ts" });
    log.add({ manualChars: 1, path: "/w/b.ts" });
    log.drain();

    log.add({ manualChars: 1, path: "/w/c.ts" });
    expect(log.drain()[0]?.filesTouched).toBe(3);
  });

  it("resets the counters after a drain, so nothing is sent twice", () => {
    const log = createActivityLog(fakeClock().now);

    log.add({ manualChars: 40 });
    expect(log.drain()[0]?.manualChars).toBe(40);
    expect(log.drain()).toEqual([]);
  });

  it("separates what the agent wrote from what the person typed", () => {
    const log = createActivityLog(fakeClock().now);

    log.add({ manualChars: 300 });
    log.add({ agentChars: 700, acceptedEdits: 2, rejectedEdits: 1 });

    const [delta] = log.drain();
    expect(delta?.manualChars).toBe(300);
    expect(delta?.agentChars).toBe(700);
    expect(delta?.acceptedEdits).toBe(2);
    expect(delta?.rejectedEdits).toBe(1);
  });

  it("counts the gap between edits as time spent working", () => {
    const clock = fakeClock();
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 1 });
    clock.advance(5_000);
    log.add({ manualChars: 1 });
    clock.advance(9_000);
    log.add({ manualChars: 1 });

    expect(log.drain()[0]?.activeMs).toBe(14_000);
  });

  it("does not bill lunch as flow", () => {
    // Without a cap, one edit before lunch and one after would report three hours of
    // active editing. Each gap counts for at most thirty seconds.
    const clock = fakeClock();
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 1 });
    clock.advance(3 * 60 * 60 * 1000);
    log.add({ manualChars: 1 });

    expect(log.drain()[0]?.activeMs).toBe(30_000);
  });

  it("splits a session that runs across midnight into two days", () => {
    const clock = fakeClock(Date.UTC(2026, 7, 24, 23, 59, 0));
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 100 });
    clock.advance(2 * 60_000);
    log.add({ manualChars: 40 });

    const drained = log.drain();
    expect(drained.map((d) => [d.day, d.manualChars])).toEqual([
      ["2026-08-24", 100],
      ["2026-08-25", 40],
    ]);
  });

  it("forgets a finished day so its file set does not outlive the run", () => {
    const clock = fakeClock(Date.UTC(2026, 7, 24, 23, 59, 0));
    const log = createActivityLog(clock.now);

    log.add({ manualChars: 1, path: "/w/a.ts" });
    clock.advance(2 * 60_000);
    log.add({ manualChars: 1, path: "/w/b.ts" });
    log.drain();

    log.add({ manualChars: 5, path: "/w/c.ts" });
    const drained = log.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.day).toBe("2026-08-25");
  });

  it("drops a flush that would be all zeroes", () => {
    const log = createActivityLog(fakeClock().now);

    log.add({ manualChars: 3 });
    log.drain();
    log.add({ manualChars: 0, path: "/w/a.ts" });

    expect(log.drain()).toEqual([]);
  });
});

describe("mergeDeltas", () => {
  const base = {
    day: "2026-08-24",
    manualChars: 10,
    agentChars: 20,
    acceptedEdits: 1,
    rejectedEdits: 2,
    filesTouched: 4,
    activeMs: 1_000,
    sessions: 1,
  };

  it("adds the counters", () => {
    const merged = mergeDeltas(base, { ...base, manualChars: 5, activeMs: 500 });
    expect(merged.manualChars).toBe(15);
    expect(merged.activeMs).toBe(1_500);
    expect(merged.sessions).toBe(2);
  });

  it("takes the larger file count rather than summing it", () => {
    const merged = mergeDeltas(base, { ...base, filesTouched: 2 });
    expect(merged.filesTouched).toBe(4);
  });
});
