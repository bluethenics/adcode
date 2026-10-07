import { describe, it, expect } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { WebsiteEvent } from "../src/websiteAnalytics.ts";

const origin = "https://site.test";
const event = { id: "11111111-1111-4111-8111-111111111111", session: "22222222-2222-4222-8222-222222222222", name: "page_view", path: "/", device: "desktop", source: "direct", campaign: "", value: 0 };
async function setup() {
  const store = createMemoryStore();
  await store.addAdmin({ email: "owner@site.test", addedBy: "setup", addedAt: 0 });
  const records = new Map<string, WebsiteEvent>();
  const handler = createFetchHandler({ store, siteOrigin: origin, clock: { now: () => Date.UTC(2026, 8, 13, 12) },
    verifier: { async verify(token) { return token === "owner" ? { uid: "owner", claims: { email: "owner@site.test", email_verified: true } } : token === "user" ? { uid: "user", claims: {} } : null; } },
    websiteAnalytics: {
      async append(events) { for (const e of events) if (!records.has(e.id)) records.set(e.id, e); },
      async read() { return { events: [...records.values()], truncated: false }; },
    },
  });
  const post = (events: unknown[] = [event], requestOrigin = origin, agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0") => handler(new Request(`${origin}/v1/website-events`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json", "user-agent": agent }, body: JSON.stringify(events) }));
  const report = (token: string) => handler(new Request(`${origin}/v1/admin/website-analytics?days=7`, { headers: { authorization: `Bearer ${token}` } }));
  return { records, post, report };
}
describe("website analytics routes", () => {
  it("collects anonymous events but only lets verified admins read reports", async () => {
    const api = await setup();
    expect((await api.post()).status).toBe(200);
    expect((await api.post()).status).toBe(200);
    expect(api.records.size).toBe(1);
    expect((await api.report("invalid")).status).toBe(401);
    expect((await api.report("user")).status).toBe(403);
    const response = await api.report("owner");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ sessions: 1, pageViews: 1, truncated: false });
  });
  it("rejects other origins, malformed events, mixed sessions and excessive submissions", async () => {
    const api = await setup();
    expect((await api.post([event], "https://other.test")).status).toBe(403);
    expect((await api.post([{ ...event, path: "/admin/money" }])).status).toBe(400);
    expect((await api.post([event, { ...event, session: "33333333-3333-4333-8333-333333333333" }])).status).toBe(400);
    for (let i = 0; i < 30; i++) await api.post();
    expect((await api.post()).status).toBe(429);
  });
  it("stores nothing from a crawler or a scripted browser, and gives it no reason to retry", async () => {
    const api = await setup();
    const response = await api.post([event], origin, "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 0 });
    expect(api.records.size).toBe(0);
  });
  it("dates events by the age the browser sent", async () => {
    const api = await setup();
    expect((await api.post([{ ...event, age: 90_000 }])).status).toBe(200);
    const stored = [...api.records.values()][0]!;
    expect(stored.receivedAt - stored.occurredAt).toBe(90_000);
  });
});
