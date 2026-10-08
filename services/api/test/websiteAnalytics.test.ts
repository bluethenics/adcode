import { describe, it, expect } from "vitest";
import { channel, isAutomatedAgent, parseWebsiteEvents, summarizeWebsiteEvents, type WebsiteEvent } from "../src/websiteAnalytics.ts";

const event = { id: "11111111-1111-4111-8111-111111111111", session: "22222222-2222-4222-8222-222222222222", name: "page_view", path: "/", device: "desktop", source: "direct", campaign: "", value: 0 };
/** A stored event that happened, and arrived, at `at`. */
const row = (fields: Partial<WebsiteEvent> & { at?: number }): WebsiteEvent => {
  const { at = 1000, ...rest } = fields;
  return { ...event, receivedAt: at, occurredAt: at, placement: "", ...rest };
};

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

  /*
   * A batch of twenty used to share one arrival time, and two requests that crossed on the
   * network swapped order. The browser sends each event's age; the server subtracts it.
   */
  it("dates each event by when it happened, from the age the browser sent", () => {
    const [early, late] = parseWebsiteEvents([{ ...event, age: 2500 }, { ...event, id: "33333333-3333-4333-8333-333333333333", age: 400 }], 10_000)!;
    expect(early).toMatchObject({ receivedAt: 10_000, occurredAt: 7_500 });
    expect(late).toMatchObject({ receivedAt: 10_000, occurredAt: 9_600 });
    expect(parseWebsiteEvents([event], 10_000)?.[0]?.occurredAt).toBe(10_000);
    for (const age of [-1, 86_400_001, Number.NaN, "5"]) expect(parseWebsiteEvents([{ ...event, age }], 10_000)).toBeNull();
  });
  it("counts invite-page visits by the loop that sent them, and nothing else", () => {
    const ids = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
    const report = summarizeWebsiteEvents([
      row({ id: ids(1), path: "/i/abc1234", source: "readme" }),
      row({ id: ids(2), path: "/i/abc1234", source: "readme" }),
      row({ id: ids(3), path: "/i/zz-code/", source: "t.co" }),
      row({ id: ids(4), path: "/invite", source: "readme" }),
      row({ id: ids(5), path: "/i/abc1234", source: "readme", name: "scroll_50" }),
    ], 0, 86400000, false);
    expect(report.invitePages).toEqual([{ label: "readme", count: 2 }, { label: "x", count: 1 }]);
  });
  it("orders a funnel by when things happened, not by which request arrived first", () => {
    // The download's request landed before the page view's, but happened after it.
    const view = row({ at: 5000 });
    const download = row({ id: "33333333-3333-4333-8333-333333333333", name: "download_click", receivedAt: 4000, occurredAt: 6000 });
    expect(summarizeWebsiteEvents([download, view], 0, 86400000, false).funnels[0]?.steps.map(step => step.sessions)).toEqual([1, 1]);
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
    const entry = row({ path: "/portal/campaigns/new", at: 2000 });
    const conversion = row({ id: "33333333-3333-4333-8333-333333333333", name: "campaign_created", at: 1000 });
    const early = summarizeWebsiteEvents([entry, conversion], 0, 86400000, false);
    expect(early.funnels[1]?.steps[1]).toMatchObject({ sessions: 0, lost: 1 });
    const complete = summarizeWebsiteEvents([entry, { ...conversion, receivedAt: 3000, occurredAt: 3000 }], 0, 86400000, false);
    expect(complete.funnels[1]?.steps[1]).toMatchObject({ sessions: 1, lost: 0 });
  });
  it("includes homepage advertiser entry and counts each converting session once", () => {
    const entry = row({ name: "advertise_click", at: 1000 });
    const conversion = row({ id: "33333333-3333-4333-8333-333333333333", name: "campaign_created", at: 2000 });
    const portal = row({ id: "44444444-4444-4444-8444-444444444444", path: "/portal/campaigns/new", at: 1500 });
    const report = summarizeWebsiteEvents([conversion, portal, entry], 0, 86400000, false);
    expect(report.funnels[1]?.steps.map(step => step.sessions)).toEqual([1, 1]);
    expect(report.funnels[1]?.steps[1]?.lost).toBe(0);
  });
  it("separates installation-page visitors from general and returning traffic", () => {
    const rows = [
      row({ at: 1000, path: "/dashboard" }),
      row({ id: "2", session: "installer", at: 2000, path: "/docs/installing-adcode" }),
      row({ id: "3", session: "installer", at: 3000, path: "/docs/installing-adcode", name: "install_copy" }),
      row({ id: "4", session: "reader", at: 4000, path: "/docs" }),
    ];
    const report = summarizeWebsiteEvents(rows, 0, 86400000, false);
    expect(report.funnels[0]?.steps.map(step => step.sessions)).toEqual([3, 1]);
    expect(report.funnels.find(funnel => funnel.label === "Installation pages")?.steps.map(step => step.sessions)).toEqual([1, 1]);
  });
  it("counts direct advertiser portal visits even before the campaign builder opens", () => {
    expect(summarizeWebsiteEvents([row({ path: "/portal", at: 1000 })], 0, 86400000, false).funnels[1]?.steps.map(step => step.sessions)).toEqual([1, 0]);
  });

  /*
   * Which button on the page a download came from. The home page has two install buttons -
   * the hero and the closing one - and a change to either could only be judged by the total
   * until each said which it was.
   */
  it("keeps which button an event came from, as a short word", () => {
    expect(parseWebsiteEvents([{ ...event, name: "download_click", placement: "hero" }], 1000)?.[0]?.placement).toBe("hero");
    expect(parseWebsiteEvents([event], 1000)?.[0]?.placement).toBe("");
    for (const placement of ["Hero Button", "x".repeat(41), "<script>", 3]) {
      expect(parseWebsiteEvents([{ ...event, placement }], 1000)).toBeNull();
    }
  });

  it("ranks install actions by the button they came from", () => {
    const events = parseWebsiteEvents([
      { ...event, id: "33333333-3333-4333-8333-333333333333", name: "download_click", placement: "hero" },
      { ...event, id: "44444444-4444-4444-8444-444444444444", name: "download_click", placement: "hero" },
      { ...event, id: "55555555-5555-4555-8555-555555555555", name: "download_click", placement: "closing" },
      { ...event, id: "66666666-6666-4666-8666-666666666666", name: "install_copy" },
    ], 1000)!;
    expect(summarizeWebsiteEvents(events, 0, 86400000, false).placements).toEqual([
      { label: "hero", count: 2 },
      { label: "closing", count: 1 },
      { label: "(none)", count: 1 },
    ]);
  });

  it("counts one channel under one name, including events recorded before the grouping", () => {
    expect(["x", "X", "twitter", "t.co", "x.com", "mobile.twitter.com"].map(channel)).toEqual(Array(6).fill("x"));
    expect(["threads", "l.threads.com", "www.threads.net"].map(channel)).toEqual(["threads", "threads", "threads"]);
    expect(["www.google.com", "google.co.in", "news.ycombinator.com", "direct", "newsletter"].map(channel)).toEqual(["google", "google", "hacker-news", "direct", "newsletter"]);
    const views = ["t.co", "x.com", "l.threads.com"].map((source, index) => row({ id: String(index), session: String(index), source }));
    expect(summarizeWebsiteEvents(views, 0, 86400000, false).sources).toEqual([{ label: "x", count: 2 }, { label: "threads", count: 1 }]);
  });

  it("keeps the latest value of a Web Vital re-sent under the same id", () => {
    const first = row({ id: "77777777-7777-4777-8777-777777777777", name: "CLS", value: 0.02 });
    const later = { ...first, value: 0.31, receivedAt: 5000 };
    const report = summarizeWebsiteEvents([first, later], 0, 86400000, false);
    expect(report.metrics.find((metric) => metric.name === "CLS")).toEqual({ name: "CLS", samples: 1, p75: 0.31 });
  });

  it("tells crawlers and scripted browsers from people", () => {
    for (const agent of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 HeadlessChrome/126.0", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (Linux; Android 11; moto g) Chrome-Lighthouse"]) {
      expect(isAutomatedAgent(agent)).toBe(true);
    }
    for (const agent of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Mozilla/5.0 (Linux; Android 10; CUBOT X30) Chrome/120.0 Mobile", undefined]) {
      expect(isAutomatedAgent(agent)).toBe(false);
    }
  });
});
