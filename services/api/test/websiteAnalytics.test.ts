import { describe, it, expect } from "vitest";
import { parseWebsiteEvents, summarizeWebsiteEvents } from "../src/websiteAnalytics.ts";

const event = { id: "11111111-1111-4111-8111-111111111111", session: "22222222-2222-4222-8222-222222222222", name: "page_view", path: "/", device: "desktop", source: "direct", campaign: "", value: 0 };

describe("website analytics", () => {
  it("rejects arbitrary properties, private paths, query strings and unbounded batches", () => {
    for (const bad of [{ ...event, email: "private@example.com" }, { ...event, path: "/admin" }, { ...event, path: "/?token=secret" }, { ...event, value: Infinity }]) {
      expect(parseWebsiteEvents([bad], 1000)).toBeNull();
    }
    expect(parseWebsiteEvents(Array(21).fill(event), 1000)).toBeNull();
  });
  it("uses server time and restricts the event vocabulary", () => {
    expect(parseWebsiteEvents([event], 1000)?.[0]?.receivedAt).toBe(1000);
    expect(parseWebsiteEvents([{ ...event, name: "password" }], 1000)).toBeNull();
  });
  it("deduplicates deliveries and measures conversion sessions instead of clicks", () => {
    const events = parseWebsiteEvents([event, { ...event, id: "33333333-3333-4333-8333-333333333333", name: "install_copy" }], 1000)!;
    const report = summarizeWebsiteEvents([...events, ...events], 0, 86400000, false);
    expect(report.pageViews).toBe(1);
    expect(report.sessions).toBe(1);
    expect(report.installSessions).toBe(1);
    expect(report.daily).toEqual([{ day: "1970-01-01", views: 1, sessions: 1 }]);
  });
  it("counts ordered funnel steps and excludes conversions preceding entry", () => {
    const entry = parseWebsiteEvents([{ ...event, path: "/portal/campaigns/new" }], 2000)![0]!;
    const conversion = parseWebsiteEvents([{ ...event, id: "33333333-3333-4333-8333-333333333333", name: "campaign_created" }], 1000)![0]!;
    const early = summarizeWebsiteEvents([entry, conversion], 0, 86400000, false);
    expect(early.funnels[1]?.steps[1]).toMatchObject({ sessions: 0, lost: 1 });
    const complete = summarizeWebsiteEvents([entry, { ...conversion, receivedAt: 3000 }], 0, 86400000, false);
    expect(complete.funnels[1]?.steps[1]).toMatchObject({ sessions: 1, lost: 0 });
  });
});
