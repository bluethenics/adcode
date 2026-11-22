/**
 * The admin website report, built from one summary query instead of raw events.
 *
 * The old report read at most 20,000 raw events into the Worker and counted them there. The
 * site logged 56,212 events in the 30 days to 20 Nov 2026, so the 30- and 90-day reports were
 * "the most recent 20,000 events" with a warning, not the period. `read_website_analytics_summary`
 * (migration 20261120180100) counts the whole period in Postgres; this file turns its answer into
 * exactly the shape `summarizeWebsiteEvents` returns, so the page and the tests need no second
 * format. Traffic sources are merged into channels here, by the same `channel()` the old path
 * used, because the database returns them as recorded.
 */
import { channel, WEB_VITALS, type summarizeWebsiteEvents } from "./websiteAnalytics.ts";
import { toCsv } from "./csv.ts";

export type WebsiteReport = ReturnType<typeof summarizeWebsiteEvents>;
export interface Ranked { label: string; count: number }

/** `read_website_analytics_summary`. */
export interface RawWebsiteSummary {
  totalEvents: number; pageViews: number; sessions: number; installSessions: number; errorCount: number; engagementMs: number;
  daily: { day: string; views: number; sessions: number }[];
  funnels: { install: [number, number]; advertiser: [number, number]; installPages: [number, number] };
  rankings: Partial<Record<"pages" | "sources" | "campaigns" | "devices" | "events" | "placements" | "invitePages", Ranked[]>>;
  metrics: { name: string; samples: number; p75: number | null }[] | null;
}

/** Top 20, with raw labels folded first: sources into channels, empty labels into "(none)". */
export function rankLabels(rows: readonly Ranked[] | undefined, fold: (label: string) => string = (label) => label): Ranked[] {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const label = fold(row.label) || "(none)";
    counts.set(label, (counts.get(label) ?? 0) + Number(row.count));
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 20);
}

const twoStep = (label: string, first: string, second: string, counts: readonly [number, number]): WebsiteReport["funnels"][number] => ({
  label,
  steps: [{ label: first, sessions: counts[0], lost: 0 }, { label: second, sessions: counts[1], lost: counts[0] - counts[1] }],
});

export function websiteReportFromSummary(raw: RawWebsiteSummary, start: number, end: number): WebsiteReport {
  const views = new Map(raw.daily.map((day) => [day.day, day]));
  const daily: WebsiteReport["daily"] = [];
  for (let at = start; at < end; at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    daily.push({ day, views: views.get(day)?.views ?? 0, sessions: views.get(day)?.sessions ?? 0 });
  }
  const metrics = WEB_VITALS.map((name) => {
    const found = raw.metrics?.find((metric) => metric.name === name);
    return { name, samples: Number(found?.samples ?? 0), p75: found?.p75 ?? null };
  });
  return {
    start, end, truncated: false, totalEvents: raw.totalEvents, pageViews: raw.pageViews, sessions: raw.sessions, installSessions: raw.installSessions,
    errorCount: raw.errorCount, engagementSeconds: Math.round(raw.engagementMs / 1000), daily,
    funnels: [
      twoStep("Install journey", "Visited website", "Copied install or clicked download", raw.funnels.install),
      twoStep("Advertiser journey", "Entered advertiser flow", "Created campaign", raw.funnels.advertiser),
      twoStep("Installation pages", "Viewed install page or installation guide", "Copied install or clicked download", raw.funnels.installPages),
    ],
    pages: rankLabels(raw.rankings.pages), sources: rankLabels(raw.rankings.sources, channel), campaigns: rankLabels(raw.rankings.campaigns),
    devices: rankLabels(raw.rankings.devices), events: rankLabels(raw.rankings.events), metrics,
    placements: rankLabels(raw.rankings.placements), invitePages: rankLabels(raw.rankings.invitePages, channel),
  };
}

export const WEBSITE_TABLES = ["daily", "pages", "sources", "campaigns", "devices", "events", "placements", "invitePages", "metrics", "funnels", "all"] as const;
export type WebsiteTable = (typeof WEBSITE_TABLES)[number];
const RANKINGS = ["pages", "sources", "campaigns", "devices", "events", "placements", "invitePages"] as const;

/** One table, or `all` as one sheet with a section column. Dates are UTC. */
export function websiteCsv(report: WebsiteReport, table: WebsiteTable): string {
  const from = new Date(report.start).toISOString().slice(0, 10), to = new Date(report.end - 1).toISOString().slice(0, 10);
  const sections: unknown[][] = [];
  const want = (name: WebsiteTable): boolean => table === "all" || table === name;
  if (want("daily")) for (const day of report.daily) sections.push(["daily", day.day, "page_views", day.views], ["daily", day.day, "sessions", day.sessions]);
  for (const name of RANKINGS) if (want(name)) for (const row of report[name] ?? []) sections.push([name, `${from} to ${to}`, row.label, row.count]);
  if (want("metrics")) for (const metric of report.metrics) sections.push(["metrics", `${from} to ${to}`, `${metric.name}_p75`, metric.p75 ?? ""], ["metrics", `${from} to ${to}`, `${metric.name}_samples`, metric.samples]);
  if (want("funnels")) for (const funnel of report.funnels) for (const step of funnel.steps) sections.push(["funnels", `${from} to ${to}`, `${funnel.label}: ${step.label}`, step.sessions]);
  if (table === "all") {
    for (const [label, value] of [["total_events", report.totalEvents], ["page_views", report.pageViews], ["sessions", report.sessions], ["install_sessions", report.installSessions], ["browser_errors", report.errorCount], ["engaged_seconds", report.engagementSeconds]] as const) {
      sections.push(["totals", `${from} to ${to}`, label, value]);
    }
  }
  return toCsv([["section", "date_or_range_utc", "label", "value"], ...sections]);
}
