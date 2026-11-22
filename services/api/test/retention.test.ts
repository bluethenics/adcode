import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import {
  RETENTION_LIMITS,
  clampEvents,
  parseRetentionEvents,
  type RetentionEvent,
  type RetentionStore,
  type RetentionSummary,
} from "../src/retention.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

describe("reading retention events", () => {
  it("accepts names from the list with fixed codes, versions and durations", () => {
    expect(parseRetentionEvents([
      { name: "first_launch", at: NOW },
      { name: "session_start", at: NOW, code: "2.6.3" },
      { name: "turn_failed", at: NOW, code: "auth" },
      { name: "cli_failed", at: NOW, code: "opencode.stopped_part_way" },
      { name: "slow_first_answer", at: NOW, ms: 31_000.4 },
    ])).toEqual([
      { name: "first_launch", at: NOW },
      { name: "session_start", at: NOW, code: "2.6.3" },
      { name: "turn_failed", at: NOW, code: "auth" },
      { name: "cli_failed", at: NOW, code: "opencode.stopped_part_way" },
      { name: "slow_first_answer", at: NOW, ms: 31_000 },
    ]);
  });

  it("refuses anything that could carry a prompt, a path, code or chat text", () => {
    expect(parseRetentionEvents([{ name: "turn_failed", at: NOW, code: "HTTP 401: invalid key sk-live-123" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "project_opened", at: NOW, code: "c:/users/ana/bank-app" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "ai_message", at: NOW, text: "build me a bank" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "ai_message", at: NOW, code: "x" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "session_start", at: NOW, code: "my-secret-project" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "file_opened", at: NOW }])).toBeNull();
    expect(parseRetentionEvents([{ name: "ai_message", at: "now" }])).toBeNull();
    expect(parseRetentionEvents([{ name: "ai_message", at: NOW, ms: -1 }])).toBeNull();
    expect(parseRetentionEvents([])).toBeNull();
    expect(parseRetentionEvents(Array.from({ length: RETENTION_LIMITS.perRequest + 1 }, () => ({ name: "ai_message", at: NOW })))).toBeNull();
  });

  it("clamps times into the last week", () => {
    expect(clampEvents([{ name: "first_launch", at: 1 }, { name: "ai_message", at: NOW + DAY }], NOW))
      .toEqual([{ name: "first_launch", at: NOW - 7 * DAY }, { name: "ai_message", at: NOW }]);
  });
});

const SUMMARY: RetentionSummary = {
  builtAt: NOW - 60_000,
  silentDays: 7,
  totals: { users: 3, newInstalls: 2, active1d: 1, active7d: 2, active30d: 3, churned: 1 },
  cohorts: [],
  funnel: { base: 2, steps: [{ step: "first_launch", users: 2 }] },
  reasons: [{ reason: "hit_limit", users: 1 }],
  friction: [{ name: "limit_reached", churned: 1, users: 1, topCodes: [{ code: "daily", churned: 1 }] }],
};

function memoryRetention() {
  const recorded: { uid: string; now: number; events: readonly RetentionEvent[] }[] = [];
  let built: RetentionSummary | null = null;
  const calls = { refresh: 0, churned: [] as unknown[] };
  const store: RetentionStore = {
    async record(uid, now, events) { recorded.push({ uid, now, events }); },
    async summary(silentDays) { return built === null ? null : { ...built, silentDays }; },
    async refresh(now) { calls.refresh += 1; built = { ...SUMMARY, builtAt: now }; },
    async churned(input) { calls.churned.push(input); return { total: 1, users: [] }; },
    async timeline(uid) { return uid === "known" ? { user: { uid, firstSeenAt: NOW - DAY, lastSeenAt: NOW, activeDays: 1, newInstall: true, furthestStep: "ai_message", reason: "no_edit", lastError: null, lastSession: null, version: "2.6.3", counts: {} }, daily: [], events: [] } : { user: null, daily: [], events: [] }; },
  };
  return { store, recorded, calls, setBuilt: (summary: RetentionSummary | null) => { built = summary; } };
}

function setup(withRetention = true) {
  const store = createMemoryStore();
  const retention = memoryRetention();
  const handler = createFetchHandler({
    store,
    clock: { now: () => NOW },
    ...(withRetention ? { retention: retention.store } : {}),
    verifier: {
      async verify(token) {
        if (token === "owner") return { uid: "owner", claims: { email: "owner@site.test", email_verified: true } };
        return token === "user" ? { uid: "user", claims: {} } : null;
      },
    },
  });
  const post = (body: unknown, token = "user") => handler(new Request("https://site.test/v1/milestones", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  const admin = async (path: string, method = "GET", token = "owner") => {
    await store.addAdmin({ email: "owner@site.test", addedBy: "setup", addedAt: 0 });
    return handler(new Request(`https://site.test/v1/admin/retention${path}`, { method, headers: { authorization: `Bearer ${token}` } }));
  };
  return { post, admin, retention, store };
}

describe("events on the milestone flush", () => {
  it("records events against the signed-in account, clamped, beside milestones", async () => {
    const { post, retention } = setup();
    const response = await post({ milestones: [{ name: "prompt_sent", at: NOW }], events: [{ name: "ai_message", at: NOW }, { name: "first_launch", at: 5 }] });
    expect(response.status).toBe(200);
    expect(retention.recorded).toEqual([{ uid: "user", now: NOW, events: [{ name: "ai_message", at: NOW }, { name: "first_launch", at: NOW - 7 * DAY }] }]);
  });

  it("accepts a flush with only events", async () => {
    const { post, retention } = setup();
    expect((await post({ events: [{ name: "day_active", at: NOW }] })).status).toBe(200);
    expect(retention.recorded).toHaveLength(1);
  });

  it("refuses a flush whose events carry anything outside the lists, and stores none of it", async () => {
    const { post, retention } = setup();
    expect((await post({ milestones: [{ name: "prompt_sent", at: NOW }], events: [{ name: "turn_failed", at: NOW, code: "ENOENT C:/secret" }] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(retention.recorded).toHaveLength(0);
  });

  it("drops events past the daily request budget without refusing", async () => {
    const { post, retention, store } = setup();
    const dayStart = Math.floor(NOW / DAY) * DAY;
    for (let i = 0; i < RETENTION_LIMITS.requestsPerDay - 1; i += 1) await store.bumpRequestCount("retention:user", dayStart);
    expect((await post({ events: [{ name: "turn_failed", at: NOW, code: "network" }] })).status).toBe(200);
    expect((await post({ events: [{ name: "turn_failed", at: NOW, code: "network" }] })).status).toBe(200);
    expect(retention.recorded).toHaveLength(1);
  });

  it("accepts and drops events when retention is not configured", async () => {
    const { post } = setup(false);
    expect((await post({ events: [{ name: "day_active", at: NOW }] })).status).toBe(200);
  });

  it("needs a signed-in editor", async () => {
    const { post } = setup();
    expect((await post({ events: [{ name: "day_active", at: NOW }] }, "nobody")).status).toBe(401);
  });
});

describe("the admin retention routes", () => {
  it("are for administrators only", async () => {
    const { admin } = setup();
    expect((await admin("", "GET", "user")).status).toBe(403);
  });

  it("build the summary on first open, then serve the cached one", async () => {
    const { admin, retention } = setup();
    const first = await admin("?silentDays=14");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ silentDays: 14, builtAt: NOW, totals: { churned: 1 } });
    expect(retention.calls.refresh).toBe(1);
    await admin("?silentDays=14");
    expect(retention.calls.refresh).toBe(1);
  });

  it("rebuild a summary the hourly job left stale", async () => {
    const { admin, retention } = setup();
    retention.setBuilt({ ...SUMMARY, builtAt: NOW - 4 * 3_600_000 });
    await admin("");
    expect(retention.calls.refresh).toBe(1);
  });

  it("fall back to 7 silent days for anything not cached", async () => {
    const { admin } = setup();
    expect(await (await admin("?silentDays=999")).json()).toMatchObject({ silentDays: 7 });
  });

  it("rebuild on demand", async () => {
    const { admin, retention } = setup();
    expect((await admin("/refresh", "POST")).status).toBe(200);
    expect(retention.calls.refresh).toBe(1);
  });

  it("page and filter the churned list, with bounds", async () => {
    const { admin, retention } = setup();
    expect((await admin("/churned?silentDays=30&reason=hit_limit&offset=50&limit=9999")).status).toBe(200);
    await admin("/churned?reason=made_up&offset=-4");
    expect(retention.calls.churned).toEqual([
      { now: NOW, silentDays: 30, reason: "hit_limit", offset: 50, limit: 200 },
      { now: NOW, silentDays: 7, reason: null, offset: 0, limit: 50 },
    ]);
  });

  it("serve one account's timeline, and 404 an unknown one", async () => {
    const { admin } = setup();
    expect((await admin("/user?uid=known")).status).toBe(200);
    expect((await admin("/user?uid=stranger")).status).toBe(404);
    expect((await admin("/user?uid=../etc")).status).toBe(400);
  });

  it("say so when retention is not configured", async () => {
    const { admin } = setup(false);
    expect((await admin("")).status).toBe(503);
  });
});
