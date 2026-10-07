import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { countDevelopers, occurrence, sightings, summarizeGrowth, weekStart } from "../src/growth.ts";
import type { ReceiptRecord, ServeRecord } from "../src/store.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 2, 12); // Friday 2 October 2026, 12:00 UTC

const serve = (uid: string, servedAt: number, test = false): ServeRecord => ({
  serveId: `${uid}-${servedAt}`, uid, creativeId: "c", campaignId: "k", servedAt, expiresAt: servedAt + 600_000,
  maxBidCpmMicros: 2_000_000n, clearingCpmMicros: 2_000_000n, costMicros: 2_000n, test,
});
const receipt = (id: string, outcome: string, createdAt: number, costMicros = 2_000n): ReceiptRecord => ({
  receiptId: id, uid: "u", creativeId: "c", campaignId: "k", outcome, creditedMicros: costMicros / 2n, costMicros, createdAt,
});
const user = (uid: string, createdAt: number) => ({ uid, status: "active" as const, createdAt });

describe("growth numbers", () => {
  const stats = summarizeGrowth({
    now: NOW,
    users: [
      { uid: "new", status: "active", createdAt: NOW - 2 * DAY },
      { uid: "month", status: "active", createdAt: NOW - 20 * DAY },
      { uid: "old", status: "active", createdAt: NOW - 90 * DAY },
      { uid: "banned", status: "banned", createdAt: NOW - 90 * DAY },
    ],
    serves: [
      serve("today", NOW - 3_600_000),
      serve("today", NOW - 7_200_000),
      serve("week", NOW - 3 * DAY),
      serve("month", NOW - 20 * DAY),
      serve("ancient", NOW - 40 * DAY),
      serve("tester", NOW - 60_000, true),
    ],
    receipts: [
      receipt("v1", "impression", NOW - 3_600_000),
      receipt("v2", "impression", NOW - 10 * DAY),
      receipt("v3", "impression", NOW - 60 * DAY),
      receipt("c1", "click", NOW - 3_600_000),
      receipt("t1", "impression", NOW - 60_000, 0n),
    ],
    activity: [{ uid: "writer", day: "2026-10-02" }, { uid: "today", day: "2026-10-02" }],
    withdrawals: [
      { amountMicros: 5_000_000n, status: "paid" },
      { amountMicros: 7_000_000n, status: "requested" },
      { amountMicros: 1_000_000n, status: "rejected" },
    ],
  });

  it("counts a person once however many times the editor fetched ads", () => {
    expect(stats.active1d).toBe(2); // "today" twice, plus "writer" from today's activity
    expect(stats.active7d).toBe(3);
    expect(stats.active30d).toBe(4);
  });

  it("never counts a test serve or a serve older than the window", () => {
    expect(stats.daily.at(-1)).toEqual({ day: "2026-10-02", active: 2, returning: 0, joined: 0, adsShown: 1 });
  });

  it("counts an ad as shown only when it billed, and never a click", () => {
    expect(stats.adsShown).toBe(3);
    expect(stats.adsShown7d).toBe(1);
    expect(stats.adsShown30d).toBe(2);
    expect(stats.clicks).toBe(1);
    expect(stats.creditedMicros).toBe(4_000n);
  });

  it("keeps what was earned apart from what was actually paid out", () => {
    // Credited is earnings; only a withdrawal marked paid is money that left.
    expect(stats.paidOutMicros).toBe(5_000_000n);
  });

  it("counts a developer only once the account has done something", () => {
    // "new" and "old" were created and never fetched an ad, reported activity or reached a
    // milestone - the shape of the twin accounts a first-launch race used to create.
    expect(stats.accounts).toBe(3);
    expect(stats.developers).toBe(1);
    expect(stats.joined7d).toBe(0);
    expect(stats.joined30d).toBe(1);
  });

  it("counts developers for the public total by the same rule", () => {
    const users = [user("new", NOW - 2 * DAY), user("month", NOW - 20 * DAY), { uid: "banned", status: "banned" as const, createdAt: NOW - 3 * DAY }];
    const seen = sightings({ serves: [serve("month", NOW - DAY), serve("banned", NOW - DAY)], activity: [], milestones: [{ uid: "new", name: "welcome_shown", firstAt: NOW - DAY, lastAt: NOW - DAY }] });
    // "month" made its account 20 days ago but was first seen yesterday: a new developer this
    // week, like "new". The week is counted from the first sighting, not the account.
    expect(countDevelopers(NOW, users, seen)).toEqual({ developers: 2, developersThisWeek: 2 });
  });
});

describe("who came back", () => {
  const stats = summarizeGrowth({
    now: NOW,
    users: [user("loyal", NOW - 20 * DAY), user("once", NOW - 20 * DAY), user("weekly", NOW - 10 * DAY), user("fresh", NOW - 0.5 * DAY)],
    serves: [
      serve("loyal", NOW - 20 * DAY + 60_000),
      serve("loyal", NOW - 2 * 3_600_000),
      serve("once", NOW - 20 * DAY + 60_000),
      serve("weekly", NOW - 10 * DAY + 60_000),
      serve("weekly", NOW - 2 * DAY),
      serve("fresh", NOW - 3_600_000),
    ],
    receipts: [],
    activity: [],
    milestones: [
      { uid: "fresh", name: "welcome_shown", firstAt: NOW - 0.5 * DAY, lastAt: NOW - 0.5 * DAY },
      { uid: "fresh", name: "prompt_sent", firstAt: NOW - 0.4 * DAY, lastAt: NOW - 0.4 * DAY },
      { uid: "weekly", name: "welcome_shown", firstAt: NOW - 10 * DAY, lastAt: NOW - 10 * DAY },
      { uid: "loyal", name: "welcome_shown", firstAt: NOW - 20 * DAY, lastAt: NOW - 20 * DAY },
    ],
  });

  it("separates people who came back from that day's arrivals", () => {
    // "fresh" is active today but joined today; "loyal" is active today and joined 20 days ago.
    expect(stats.active1d).toBe(2);
    expect(stats.returning1d).toBe(1);
    expect(stats.returning7d).toBe(2);
    expect(stats.daily.at(-1)).toMatchObject({ active: 2, returning: 1, joined: 1 });
  });

  it("follows each calendar week of new developers to see who returned", () => {
    expect(stats.cohorts).toHaveLength(6);
    expect(stats.cohorts.at(-1)).toMatchObject({ weekStart: "2026-09-28", joined: 1, back1d: 0, back7d: 0 });
    expect(stats.cohorts.find((cohort) => cohort.weekStart === "2026-09-21")).toMatchObject({ joined: 1, back1d: 1, back7d: 1 });
    expect(stats.cohorts.find((cohort) => cohort.weekStart === "2026-09-07")).toMatchObject({ joined: 2, back1d: 1, back7d: 1 });
  });

  it("counts the funnel out of the last 30 days' developers", () => {
    expect(stats.funnel.base).toBe(4);
    expect(stats.funnel.steps[0]).toEqual({ name: "welcome_shown", accounts: 3 });
    expect(stats.funnel.steps.find((step) => step.name === "prompt_sent")).toEqual({ name: "prompt_sent", accounts: 1 });
    expect(stats.funnel.steps.find((step) => step.name === "turn_ok")).toEqual({ name: "turn_ok", accounts: 0 });
    expect(stats.funnel.journey).toEqual([
      { name: "welcome_shown", accounts: 3 },
      { name: "prompt_sent", accounts: 1 },
      { name: "turn_ok", accounts: 0 },
      { name: "preview_opened", accounts: 0 },
    ]);
  });

  it("returns thirty days, oldest first, ending today", () => {
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily[0]!.day).toBe("2026-09-03");
  });
});

/* The audit of 2026-10-06, one case per finding. */
describe("what the numbers mean", () => {
  it("does not call a first visit a return when the account was made earlier on the website", () => {
    // Signed up on the website three days ago; opened the editor for the first time today.
    const stats = summarizeGrowth({
      now: NOW,
      users: [user("web-first", NOW - 3 * DAY)],
      serves: [serve("web-first", NOW - 5 * HOUR), serve("web-first", NOW - HOUR)],
      receipts: [],
      activity: [],
    });
    expect(stats.returning1d).toBe(0);
    expect(stats.returning7d).toBe(0);
    expect(stats.daily.at(-1)).toMatchObject({ active: 1, returning: 0, joined: 1 });
    expect(stats.joined7d).toBe(1);
    expect(stats.cohorts.at(-1)).toMatchObject({ joined: 1, back1d: 0 });
  });

  it("keeps yesterday evening's work in the last 24 hours", () => {
    // Activity on 1 October, flushed at 16:00 - twenty hours before NOW. Counted from
    // midnight it would have been 36 hours ago and fallen out of the window.
    const evening = NOW - 20 * HOUR;
    const timed = summarizeGrowth({ now: NOW, users: [user("u", NOW - 30 * DAY)], serves: [], receipts: [], activity: [{ uid: "u", day: "2026-10-01", firstAt: evening - HOUR, lastAt: evening }] });
    expect(timed.active1d).toBe(1);
    expect(timed.daily.find((day) => day.day === "2026-10-01")?.active).toBe(1);
    const legacy = summarizeGrowth({ now: NOW, users: [user("u", NOW - 30 * DAY)], serves: [], receipts: [], activity: [{ uid: "u", day: "2026-10-01" }] });
    expect(legacy.active1d).toBe(0);
  });

  it("keeps a day's activity on its own day when the flush arrived after midnight", () => {
    // Work on 1 October, flushed at 00:05 on the 2nd: both days saw the editor open.
    const flush = Date.UTC(2026, 9, 2, 0, 5);
    const stats = summarizeGrowth({ now: NOW, users: [user("u", NOW - 30 * DAY)], serves: [], receipts: [], activity: [{ uid: "u", day: "2026-10-01", firstAt: flush, lastAt: flush }] });
    expect(stats.daily.find((day) => day.day === "2026-10-01")?.active).toBe(1);
    expect(stats.daily.find((day) => day.day === "2026-10-02")?.active).toBe(1);
  });

  it("keeps the days between a milestone's first and latest time", () => {
    const stats = summarizeGrowth({
      now: NOW,
      users: [user("u", NOW - 10 * DAY)],
      serves: [],
      receipts: [],
      activity: [],
      milestones: [{ uid: "u", name: "prompt_sent", firstAt: NOW - 9 * DAY, lastAt: NOW - HOUR }],
      milestoneDays: [
        { uid: "u", day: "2026-09-23", firstAt: NOW - 9 * DAY, lastAt: NOW - 9 * DAY },
        { uid: "u", day: "2026-09-27", firstAt: NOW - 5 * DAY, lastAt: NOW - 5 * DAY + HOUR },
        { uid: "u", day: "2026-10-02", firstAt: NOW - HOUR, lastAt: NOW - HOUR },
      ],
    });
    expect(stats.daily.filter((day) => day.active > 0).map((day) => day.day)).toEqual(["2026-09-23", "2026-09-27", "2026-10-02"]);
  });

  it("compares the same people in a week from one report to the next", () => {
    const input = (now: number) => ({
      now,
      users: [user("a", NOW - 3 * DAY), user("b", NOW - 9 * DAY)],
      serves: [serve("a", NOW - 3 * DAY), serve("b", NOW - 9 * DAY)],
      receipts: [],
      activity: [],
    });
    // Friday and the following Sunday: the same week, so the same cohorts.
    const friday = summarizeGrowth(input(NOW)).cohorts;
    const sunday = summarizeGrowth(input(NOW + 2 * DAY)).cohorts;
    expect(sunday).toEqual(friday);
    expect(friday.map((cohort) => cohort.weekStart)).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(weekStart(NOW)).toBe(Date.UTC(2026, 8, 28));
    expect(weekStart(Date.UTC(2026, 8, 28))).toBe(Date.UTC(2026, 8, 28)); // a Monday is its own week
    expect(weekStart(Date.UTC(2026, 9, 4, 23, 59))).toBe(Date.UTC(2026, 8, 28)); // and Sunday ends it
  });

  it("counts only the first day in the first-day funnel, and the main path only in order", () => {
    const first = NOW - 10 * DAY;
    const stats = summarizeGrowth({
      now: NOW,
      users: [user("late", first), user("ordered", first), user("backwards", first)],
      serves: [],
      receipts: [],
      activity: [],
      milestones: [
        // Prompted three days in: a later session, not the first day.
        { uid: "late", name: "welcome_shown", firstAt: first, lastAt: first },
        { uid: "late", name: "prompt_sent", firstAt: first + 3 * DAY, lastAt: first + 3 * DAY },
        // The whole path, in order, inside the day.
        { uid: "ordered", name: "welcome_shown", firstAt: first, lastAt: first },
        { uid: "ordered", name: "prompt_sent", firstAt: first + HOUR, lastAt: first + HOUR },
        { uid: "ordered", name: "turn_ok", firstAt: first + 2 * HOUR, lastAt: first + 2 * HOUR },
        { uid: "ordered", name: "preview_opened", firstAt: first + 3 * HOUR, lastAt: first + 3 * HOUR },
        // A preview of their own folder before any answer: in the first day, not on the path.
        { uid: "backwards", name: "welcome_shown", firstAt: first, lastAt: first },
        { uid: "backwards", name: "preview_opened", firstAt: first + HOUR, lastAt: first + HOUR },
        { uid: "backwards", name: "prompt_sent", firstAt: first + 2 * HOUR, lastAt: first + 2 * HOUR },
        { uid: "backwards", name: "turn_ok", firstAt: first + 3 * HOUR, lastAt: first + 3 * HOUR },
      ],
    });
    const step = (name: string) => stats.funnel.steps.find((row) => row.name === name)?.accounts;
    expect(step("prompt_sent")).toBe(2);
    expect(step("preview_opened")).toBe(2);
    expect(stats.funnel.journey.map((row) => row.accounts)).toEqual([3, 2, 2, 1]);
  });

  it("finds a milestone's time inside a window from its first or its latest", () => {
    expect(occurrence({ firstAt: 10, lastAt: 50 }, 5, 20)).toBe(10);
    expect(occurrence({ firstAt: 10, lastAt: 50 }, 20, 60)).toBe(50);
    expect(occurrence({ firstAt: 10, lastAt: 50 }, 20, 40)).toBeNull();
    expect(occurrence(undefined, 0, 100)).toBeNull();
  });

  it("records activity times and milestone days through the store", async () => {
    const store = createMemoryStore();
    await store.putUser(user("u", NOW - 30 * DAY));
    const flush = { uid: "u", day: "2026-10-01", manualChars: 1, agentChars: 0, acceptedEdits: 0, rejectedEdits: 0, filesTouched: 0, activeMs: 0, sessions: 1 };
    await store.addActivity({ ...flush, at: NOW - 21 * HOUR });
    await store.addActivity({ ...flush, at: NOW - 20 * HOUR });
    await store.recordMilestones("u", [{ name: "prompt_sent", at: NOW - 9 * DAY }]);
    await store.recordMilestones("u", [{ name: "prompt_sent", at: NOW - 5 * DAY }]);
    await store.recordMilestones("u", [{ name: "prompt_sent", at: NOW - 2 * DAY }]);
    const stats = await store.growthStats(NOW);
    expect(stats.active1d).toBe(1);
    expect(stats.daily.filter((day) => day.active > 0).map((day) => day.day)).toEqual(["2026-09-23", "2026-09-27", "2026-09-30", "2026-10-01"]);
  });
});

describe("the admin growth route", () => {
  async function setup() {
    const store = createMemoryStore();
    await store.addAdmin({ email: "owner@site.test", addedBy: "setup", addedAt: 0 });
    await store.putUser({ uid: "private-user", status: "active", createdAt: NOW - DAY });
    const handler = createFetchHandler({
      store,
      clock: { now: () => NOW },
      verifier: {
        async verify(token) {
          if (token === "owner") return { uid: "owner", claims: { email: "owner@site.test", email_verified: true } };
          return token === "user" ? { uid: "user", claims: {} } : null;
        },
      },
    });
    return (token: string) => handler(new Request("https://site.test/v1/admin/growth", { headers: { authorization: `Bearer ${token}` } }));
  }

  it("answers admins only, uncached, with micros as a string", async () => {
    const read = await setup();
    expect((await read("user")).status).toBe(403);
    const response = await read("owner");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { daily: unknown[] };
    // Every authenticated caller is an account, so the two requests above added theirs.
    expect(body).toMatchObject({ accounts: 3, developers: 0, joined7d: 0, creditedMicros: "0", paidOutMicros: "0", asOf: NOW });
    expect(body.daily).toHaveLength(30);
    expect(JSON.stringify(body)).not.toContain("private-user");
  });
});
