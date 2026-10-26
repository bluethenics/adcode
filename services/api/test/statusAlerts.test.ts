import { describe, expect, it } from "vitest";
import type { TokenVerifier } from "../src/auth.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { ModelOutcomeRow } from "../src/modelOutcomes.ts";
import type { SendResult } from "../src/mailing.ts";
import {
  ALERT_MIN_SAMPLE,
  STATUS_ALERT_SENDER,
  describeChange,
  evaluateModelHealth,
  parseSubscribe,
  runStatusAlertBatch,
  runStatusWatch,
  type ModelTally,
  type ModelWatchRow,
  type StatusAlertJob,
  type StatusAlertStore,
} from "../src/statusAlerts.ts";

/**
 * Status alerts for anybody: the form, the watcher that decides when a model is degraded or back
 * to normal, and the routes. The SQL behind the store is held to its promises separately, in a
 * real Postgres, by `scripts/check-status-subscribers-sql.mjs`.
 */
const verifier: TokenVerifier = { async verify() { return null; } };
const T0 = Date.parse("2026-10-21T09:00:00Z");
const DAY = "2026-10-21";

function fakeAlerts() {
  const calls = { subscribed: [] as unknown[], queued: [] as Array<{ topic: string; ref: string; subject: string }>, confirmed: [] as string[], unsubscribed: [] as string[], recorded: [] as string[] };
  let rows: ModelWatchRow[] = [];
  const jobs: StatusAlertJob[] = [];
  const finished: Array<{ id: string; result: SendResult }> = [];
  const store: StatusAlertStore = {
    async subscribe(input) { calls.subscribed.push(input); return { send: true, confirmToken: "11111111-2222-4333-8444-555555555555" }; },
    async recordConfirmation(_email, providerId) { calls.recorded.push(providerId); },
    async confirm(token) { calls.confirmed.push(token); return "confirmed"; },
    async unsubscribe(token) { calls.unsubscribed.push(token); return true; },
    async watchRows() { return rows; },
    async saveWatchRows(next) { rows = [...next]; },
    async queueAlert(input) { calls.queued.push(input); return 3; },
    async claimAlerts() { return jobs.splice(0); },
    async finishAlert(id, result) { finished.push({ id, result }); },
    async counts() { return { active: 3, models: 2, incidents: 1, pending: 4 }; },
  };
  return { store, calls, rows: () => rows, jobs, finished };
}

const tally = (turns: number, errors: number, day = DAY): ModelTally => ({ modelKey: "tagflow:qwen", name: "Qwen 3.8", day, turns, errors });

describe("parseSubscribe", () => {
  it("reads a ticked form and lowercases the address", () => {
    expect(parseSubscribe({ email: "  Ana@Example.COM ", models: "on" })).toEqual({ ok: true, email: "ana@example.com", models: true, incidents: false });
  });

  it.each([
    ["no address", { models: "on" }, "invalid-email"],
    ["no domain dot", { email: "ana@localhost", models: "on" }, "invalid-email"],
    ["two addresses", { email: "a@example.com,b@example.com", models: "on" }, "invalid-email"],
    ["a header injection", { email: "a@example.com\nbcc: b@example.com", models: "on" }, "invalid-email"],
    ["nothing ticked", { email: "ana@example.com" }, "no-topic"],
    ["the hidden field filled", { email: "ana@example.com", models: "on", website: "http://spam.example" }, "bot"],
  ])("refuses %s", (_label, fields, error) => {
    expect(parseSubscribe(fields)).toEqual({ ok: false, error });
  });
});

describe("evaluateModelHealth", () => {
  const base = (over: Partial<ModelWatchRow> = {}): ModelWatchRow => ({
    modelKey: "tagflow:qwen", name: "Qwen 3.8", day: DAY, turns: 100, errors: 1, notified: "operational", goodStreak: 0, changedAt: null, checkedAt: T0, ...over,
  });

  it("records a baseline on first sight, with no alert", () => {
    const { row, change } = evaluateModelHealth(undefined, tally(500, 400), T0);
    expect(change).toBeNull();
    expect(row.notified).toBe("operational");
  });

  it("judges only the turns since the last check", () => {
    // The day is fine overall (11 of 140), but the last 40 turns are 25% failures.
    const { change } = evaluateModelHealth(base(), tally(140, 11), T0 + 900_000);
    expect(change).toMatchObject({ from: "operational", to: "outage", turns: 40, errorPct: 25 });
  });

  it("reports degraded between 5% and 25%", () => {
    expect(evaluateModelHealth(base(), tally(150, 6), T0).change).toMatchObject({ to: "degraded", errorPct: 10 });
  });

  it("says nothing on too small a window", () => {
    const { row, change } = evaluateModelHealth(base(), tally(100 + ALERT_MIN_SAMPLE - 1, 10), T0);
    expect(change).toBeNull();
    expect(row.turns).toBe(109);
  });

  it("escalates degraded to outage, but does not step down until recovery", () => {
    const degraded = base({ notified: "degraded" });
    expect(evaluateModelHealth(degraded, tally(120, 11), T0).change).toMatchObject({ from: "degraded", to: "outage" });
    const outage = base({ notified: "outage" });
    expect(evaluateModelHealth(outage, tally(120, 3), T0).change).toBeNull();
  });

  it("needs two good windows in a row to send back to normal", () => {
    const first = evaluateModelHealth(base({ notified: "degraded" }), tally(150, 1), T0);
    expect(first.change).toBeNull();
    expect(first.row.goodStreak).toBe(1);
    const second = evaluateModelHealth(first.row, tally(200, 1), T0 + 900_000);
    expect(second.change).toMatchObject({ from: "degraded", to: "operational" });
    expect(second.row).toMatchObject({ notified: "operational", goodStreak: 0, changedAt: T0 + 900_000 });
  });

  it("a bad window in between starts recovery over", () => {
    const first = evaluateModelHealth(base({ notified: "degraded" }), tally(150, 1), T0);
    const bad = evaluateModelHealth(first.row, tally(200, 6), T0 + 1);
    expect(bad.row.goodStreak).toBe(0);
    expect(bad.change).toBeNull();
  });

  it("starts a new day's window from zero", () => {
    const { change } = evaluateModelHealth(base({ day: "2026-10-20", turns: 9_000, errors: 10 }), tally(20, 10, DAY), T0);
    expect(change).toMatchObject({ to: "outage", turns: 20 });
  });
});

describe("describeChange", () => {
  it("names the model and the number in each kind of email", () => {
    expect(describeChange("Qwen 3.8", { from: "operational", to: "degraded", errorPct: 12.5, turns: 40 }).subject).toBe("Degraded: Qwen 3.8 has elevated errors");
    expect(describeChange("Qwen 3.8", { from: "degraded", to: "outage", errorPct: 60, turns: 40 }).summary).toContain("60% of the last 40 requests");
    expect(describeChange("Qwen 3.8", { from: "outage", to: "operational", errorPct: 0.5, turns: 40 }).subject).toBe("Resolved: Qwen 3.8 is back to normal");
  });
});

describe("runStatusWatch", () => {
  const rows = (ok: number, failed: number, model = "qwen"): ModelOutcomeRow[] => [
    { day: DAY, provider: "tagflow", model, outcome: "ok", count: ok, totalMs: ok * 1000 },
    { day: DAY, provider: "tagflow", model, outcome: "server", count: failed, totalMs: 0 },
    // A signed-out turn is the person's situation, not the model's; it must not count.
    { day: DAY, provider: "tagflow", model, outcome: "auth", count: 500, totalMs: 0 },
    // Somebody's own key is not ADCode's outage.
    { day: DAY, provider: "openrouter", model: "x", outcome: "server", count: 500, totalMs: 0 },
  ];

  it("baselines, then queues one alert per change on the models list", async () => {
    const alerts = fakeAlerts();
    let outcomes = rows(100, 0);
    const store = { modelOutcomesSince: async () => outcomes };
    const first = await runStatusWatch({ store, alerts: alerts.store, siteOrigin: "https://adcode.test", now: T0 });
    expect(first).toEqual({ models: 1, changes: [] });

    outcomes = rows(120, 20);
    const second = await runStatusWatch({ store, alerts: alerts.store, siteOrigin: "https://adcode.test", now: T0 + 900_000 });
    expect(second.changes).toEqual([{ model: "Qwen", from: "operational", to: "outage", queued: 3 }]);
    expect(alerts.calls.queued[0]).toMatchObject({ topic: "models", subject: "Outage: Qwen is failing requests" });
    expect(alerts.rows()[0]).toMatchObject({ notified: "outage", turns: 140, errors: 20 });
  });
});

describe("runStatusAlertBatch", () => {
  const job: StatusAlertJob = {
    id: "job-1", email: "ana@example.com", attempts: 1, topic: "models", subject: "Degraded: Qwen",
    payload: { title: "Qwen is having trouble", summary: "12% failed.", status: "degraded", url: "https://adcode.test/status" },
    manageToken: "99999999-2222-4333-8444-555555555555",
  };
  const settings = async () => ({ enabled: true, postalAddress: "1 Example Street, Example City", senderVerified: true });

  it("sends from noreply with a one-click unsubscribe, and records the outcome", async () => {
    const alerts = fakeAlerts();
    alerts.jobs.push(job);
    const sent: Array<Record<string, unknown>> = [];
    const result = await runStatusAlertBatch({
      alerts: alerts.store, settings, apiKey: "re_test", siteOrigin: "https://adcode.test",
      render: async () => ({ subject: job.subject, html: "<p>x</p>", text: "x" }),
      fetchImpl: (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body)) as Record<string, unknown>); return new Response(JSON.stringify({ id: "re_1" })); }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "complete", sent: 1, failed: 0 });
    expect(sent[0]).toMatchObject({ from: STATUS_ALERT_SENDER, to: ["ana@example.com"], headers: { "List-Unsubscribe": "<https://adcode.test/v1/status/unsubscribe?token=99999999-2222-4333-8444-555555555555>" } });
    expect(sent[0]).not.toHaveProperty("reply_to");
    expect(STATUS_ALERT_SENDER).toContain("noreply@bluethenics.com");
    expect(alerts.finished).toEqual([{ id: "job-1", result: { providerId: "re_1" } }]);
  });

  it("sends nothing while sending is switched off", async () => {
    const alerts = fakeAlerts();
    alerts.jobs.push(job);
    const result = await runStatusAlertBatch({
      alerts: alerts.store, settings: async () => ({ enabled: false, postalAddress: null, senderVerified: true }), apiKey: "re_test", siteOrigin: "https://adcode.test",
      render: async () => ({ subject: "", html: "", text: "" }),
    });
    expect(result.status).toBe("disabled");
    expect(alerts.jobs).toHaveLength(1);
  });
});

describe("routes", () => {
  const setup = () => {
    const alerts = fakeAlerts();
    const mailed: unknown[] = [];
    const handle = createFetchHandler({
      store: createMemoryStore(), verifier, clock: { now: () => T0 }, statusAlerts: alerts.store,
      statusConfirmationMailer: async (input) => { mailed.push(input); return { providerId: "re_confirm" }; },
    });
    const post = (path: string, body: string, headers: Record<string, string> = {}) =>
      handle(new Request("https://adcode.test" + path, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }));
    return { alerts, mailed, handle, post };
  };

  it("a plain form post sends one confirmation and redirects to check your inbox", async () => {
    const { alerts, mailed, post } = setup();
    const response = await post("/v1/status/subscribe", "email=ana%40example.com&models=on&incidents=on&website=");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/status/subscription?state=check-email");
    expect(alerts.calls.subscribed).toEqual([{ email: "ana@example.com", models: true, incidents: true, now: T0 }]);
    expect(mailed).toEqual([{ email: "ana@example.com", confirmToken: "11111111-2222-4333-8444-555555555555", models: true, incidents: true }]);
    expect(alerts.calls.recorded).toEqual(["re_confirm"]);
  });

  it("answers JSON callers in JSON", async () => {
    const { post } = setup();
    const response = await post("/v1/status/subscribe", JSON.stringify({ email: "nope", models: true }), { "content-type": "application/json" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ state: "invalid-email" });
  });

  it("a bot gets the same answer and nothing is sent", async () => {
    const { alerts, mailed, post } = setup();
    const response = await post("/v1/status/subscribe", "email=ana%40example.com&models=on&website=spam");
    expect(response.headers.get("location")).toBe("/status/subscription?state=check-email");
    expect(alerts.calls.subscribed).toHaveLength(0);
    expect(mailed).toHaveLength(0);
  });

  it("limits each network to a few tries per ten minutes", async () => {
    const { post } = setup();
    const locations: Array<string | null> = [];
    for (let i = 0; i < 7; i += 1) {
      locations.push((await post("/v1/status/subscribe", `email=a${String(i)}%40example.com&models=on`, { "cf-connecting-ip": "203.0.113.9" })).headers.get("location"));
    }
    expect(locations.slice(0, 5).every((location) => location?.endsWith("check-email"))).toBe(true);
    expect(locations[6]).toBe("/status/subscription?state=busy");
  });

  it("confirms only by POST, never by visiting a link", async () => {
    const { alerts, handle, post } = setup();
    const token = "11111111-2222-4333-8444-555555555555";
    const response = await post("/v1/status/confirm", `token=${token}`);
    expect(response.headers.get("location")).toBe("/status/subscription?state=confirmed");
    expect(alerts.calls.confirmed).toEqual([token]);
    expect((await handle(new Request(`https://adcode.test/v1/status/confirm?token=${token}`))).status).not.toBe(303);
    expect(alerts.calls.confirmed).toHaveLength(1);
  });

  it("a GET on the unsubscribe link asks first; the mail app's one-click POST does it", async () => {
    const { alerts, handle, post } = setup();
    const token = "99999999-2222-4333-8444-555555555555";
    const visit = await handle(new Request(`https://adcode.test/v1/status/unsubscribe?token=${token}`));
    expect(visit.status).toBe(303);
    expect(visit.headers.get("location")).toBe(`/status/subscription?unsubscribe=${token}`);
    expect(alerts.calls.unsubscribed).toHaveLength(0);
    const oneClick = await post(`/v1/status/unsubscribe?token=${token}`, "List-Unsubscribe=One-Click");
    expect(oneClick.status).toBe(200);
    expect(alerts.calls.unsubscribed).toEqual([token]);
    const button = await post("/v1/status/unsubscribe", `token=${token}`);
    expect(button.headers.get("location")).toBe("/status/subscription?state=unsubscribed");
  });
});

describe("incident emails", () => {
  it("an announced incident update also reaches the status page's own incident list", async () => {
    const { handleAnnounce } = await import("../src/announcements.ts");
    const store = createMemoryStore();
    await store.createStatusIncident(
      { incidentId: "inc-1", title: "Slow answers", impact: "minor", status: "investigating", authorUid: "admin-1", createdAt: T0, updatedAt: T0, resolvedAt: null },
      { updateId: "upd-1", incidentId: "inc-1", status: "investigating", body: "Looking now.", authorUid: "admin-1", createdAt: T0 },
    );
    const alerts = fakeAlerts();
    const mailing = { announce: async () => 2, settings: async () => ({ enabled: true, postalAddress: "x", senderVerified: true }) };
    const outcome = await handleAnnounce(
      { store, clock: { now: () => T0 }, siteOrigin: "https://adcode.test", mailing: mailing as never, statusAlerts: alerts.store },
      "admin-1", { topic: "status", incident: "inc-1" },
    );
    expect(outcome).toEqual({ status: 200, body: { queued: 5, sendingEnabled: true } });
    expect(alerts.calls.queued).toEqual([expect.objectContaining({ topic: "incidents", ref: "inc-1/upd-1", subject: "Investigating: Slow answers" })]);
  });
});
