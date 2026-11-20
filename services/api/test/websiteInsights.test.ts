import { describe, expect, it } from "vitest";
import { rankLabels, websiteCsv, websiteReportFromSummary, type RawWebsiteSummary } from "../src/websiteInsights.ts";
import { channel } from "../src/websiteAnalytics.ts";

const DAY = 86_400_000;
const start = Date.parse("2026-11-18T00:00:00Z"), end = start + 3 * DAY;
const raw: RawWebsiteSummary = {
  totalEvents: 60_000, pageViews: 21_000, sessions: 9000, installSessions: 700, errorCount: 12, engagementMs: 125_400,
  daily: [{ day: "2026-11-19", views: 21_000, sessions: 9000 }],
  funnels: { install: [9000, 700], advertiser: [40, 3], installPages: [1200, 500] },
  rankings: {
    pages: [{ label: "/", count: 9000 }, { label: "/pricing", count: 3000 }],
    sources: [{ label: "x", count: 100 }, { label: "t.co", count: 50 }, { label: "twitter", count: 25 }, { label: "", count: 500 }, { label: "news.ycombinator.com", count: 70 }],
    campaigns: [{ label: "", count: 20_000 }, { label: "launch", count: 1000 }],
    devices: [{ label: "desktop", count: 15_000 }],
    events: [], placements: [{ label: "", count: 5 }, { label: "hero", count: 9 }],
    invitePages: [{ label: "twitter", count: 3 }, { label: "x.com", count: 2 }],
  },
  metrics: [{ name: "LCP", samples: 40, p75: 1800 }, { name: "CLS", samples: 30, p75: 0.04 }],
};

describe("the website report from one summary query", () => {
  const report = websiteReportFromSummary(raw, start, end);

  it("is the whole period, never flagged partial", () => {
    expect(report.truncated).toBe(false);
    expect(report.totalEvents).toBe(60_000);
    expect(report.engagementSeconds).toBe(125);
  });

  it("fills every UTC day in the window", () => {
    expect(report.daily.map((day) => day.day)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(report.daily[0]).toEqual({ day: "2026-11-18", views: 0, sessions: 0 });
  });

  it("merges source spellings into channels, as the event report did", () => {
    expect(report.sources[0]).toEqual({ label: "direct", count: 500 });
    expect(report.sources).toContainEqual({ label: "x", count: 175 });
    expect(report.sources).toContainEqual({ label: "hacker-news", count: 70 });
    expect(report.invitePages).toEqual([{ label: "x", count: 5 }]);
    expect(report.campaigns[0]).toEqual({ label: "(none)", count: 20_000 });
    expect(report.placements).toEqual([{ label: "hero", count: 9 }, { label: "(none)", count: 5 }]);
    expect(channel("")).toBe("direct");
  });

  it("builds two-step funnels with the drop-off", () => {
    expect(report.funnels.map((funnel) => funnel.label)).toEqual(["Install journey", "Advertiser journey", "Installation pages"]);
    expect(report.funnels[0]!.steps[1]).toEqual({ label: "Copied install or clicked download", sessions: 700, lost: 8300 });
  });

  it("lists every page-speed metric, with no value where nothing was measured", () => {
    expect(report.metrics.map((metric) => metric.name)).toEqual(["LCP", "CLS", "INP", "FCP", "TTFB"]);
    expect(report.metrics[2]).toEqual({ name: "INP", samples: 0, p75: null });
  });

  it("caps a ranking at twenty and breaks ties by name", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `/p${String(i).padStart(2, "0")}`, count: 5 }));
    const top = rankLabels(many);
    expect(top).toHaveLength(20);
    expect(top[0]!.label).toBe("/p00");
  });

  it("exports one table, or all of them with a section column", () => {
    const pages = websiteCsv(report, "pages").replace(/^﻿/, "").split("\r\n");
    expect(pages[0]).toBe('"section","date_or_range_utc","label","value"');
    expect(pages).toHaveLength(3);
    expect(pages[1]).toBe('"pages","2026-11-18 to 2026-11-20","/",9000');
    const all = websiteCsv(report, "all");
    for (const section of ["daily", "sources", "metrics", "funnels", "totals"]) expect(all).toContain(`"${section}"`);
  });
});
