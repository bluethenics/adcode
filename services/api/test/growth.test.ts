import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { summarizeGrowth } from "../src/growth.ts";
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
    expect(stats.daily.at(-1)).toEqual({ day: "2026-10-02", active: 2, joined: 0, adsShown: 1 });
  });

  it("counts an ad as shown only when it billed, and never a click", () => {
    expect(stats.adsShown).toBe(3);
    expect(stats.adsShown7d).toBe(1);
    expect(stats.adsShown30d).toBe(2);
    expect(stats.clicks).toBe(1);
    expect(stats.creditedMicros).toBe(4_000n);
  });

  it("counts accounts the same way the public total does", () => {
    expect(stats.developers).toBe(3);
    expect(stats.joined7d).toBe(1);
    expect(stats.joined30d).toBe(2);
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
    expect(body).toMatchObject({ developers: 3, joined7d: 3, creditedMicros: "0", asOf: NOW });
    expect(body.daily).toHaveLength(30);
    expect(JSON.stringify(body)).not.toContain("private-user");
  });
});
