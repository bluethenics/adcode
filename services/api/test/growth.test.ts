import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { countDevelopers, sightings, summarizeGrowth } from "../src/growth.ts";
import type { ReceiptRecord, ServeRecord } from "../src/store.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 2, 12);

const serve = (uid: string, servedAt: number, test = false): ServeRecord => ({
  serveId: `${uid}-${servedAt}`, uid, creativeId: "c", campaignId: "k", servedAt, expiresAt: servedAt + 600_000,
  maxBidCpmMicros: 2_000_000n, clearingCpmMicros: 2_000_000n, costMicros: 2_000n, test,
});
const receipt = (id: string, outcome: string, createdAt: number, costMicros = 2_000n): ReceiptRecord => ({
  receiptId: id, uid: "u", creativeId: "c", campaignId: "k", outcome, creditedMicros: costMicros / 2n, costMicros, createdAt,
});

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

  it("counts a developer only once the account has done something", () => {
    // "new" and "old" were created and never fetched an ad, reported activity or reached a
    // milestone - the shape of the twin accounts a first-launch race used to create.
    expect(stats.accounts).toBe(3);
    expect(stats.developers).toBe(1);
    expect(stats.joined7d).toBe(0);
    expect(stats.joined30d).toBe(1);
  });

  it("counts developers for the public total by the same rule", () => {
    const users = [
      { uid: "new", status: "active" as const, createdAt: NOW - 2 * DAY },
      { uid: "month", status: "active" as const, createdAt: NOW - 20 * DAY },
      { uid: "banned", status: "banned" as const, createdAt: NOW - 3 * DAY },
    ];
    const seen = sightings({ serves: [serve("month", NOW - DAY), serve("banned", NOW - DAY)], activity: [], milestones: [{ uid: "new", name: "welcome_shown", firstAt: NOW - DAY, lastAt: NOW - DAY }] });
    expect(countDevelopers(NOW, users, seen)).toEqual({ developers: 2, developersThisWeek: 1 });
  });
});

describe("who came back", () => {
  const user = (uid: string, daysAgo: number) => ({ uid, status: "active" as const, createdAt: NOW - daysAgo * DAY });
  const stats = summarizeGrowth({
    now: NOW,
    users: [user("loyal", 20), user("once", 20), user("weekly", 10), user("fresh", 0.5)],
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

  it("follows each week of sign-ups to see who returned", () => {
    expect(stats.cohorts).toHaveLength(6);
    expect(stats.cohorts.at(-1)).toMatchObject({ joined: 1, back1d: 0, back7d: 0 });
    const twoWeeksAgo = stats.cohorts.find((cohort) => cohort.joined === 1 && cohort.back1d === 1 && cohort.back7d === 1);
    expect(twoWeeksAgo).toBeDefined();
    const threeWeeksAgo = stats.cohorts.find((cohort) => cohort.joined === 2);
    expect(threeWeeksAgo).toMatchObject({ back1d: 1, back7d: 1 });
  });

  it("counts the funnel out of the last 30 days' developers", () => {
    expect(stats.funnel.base).toBe(4);
    expect(stats.funnel.steps[0]).toEqual({ name: "welcome_shown", accounts: 3 });
    expect(stats.funnel.steps.find((step) => step.name === "prompt_sent")).toEqual({ name: "prompt_sent", accounts: 1 });
    expect(stats.funnel.steps.find((step) => step.name === "turn_ok")).toEqual({ name: "turn_ok", accounts: 0 });
  });

  it("returns thirty days, oldest first, ending today", () => {
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily[0]!.day).toBe("2026-09-03");
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
    expect(body).toMatchObject({ accounts: 3, developers: 0, joined7d: 0, creditedMicros: "0", asOf: NOW });
    expect(body.daily).toHaveLength(30);
    expect(JSON.stringify(body)).not.toContain("private-user");
  });
});
