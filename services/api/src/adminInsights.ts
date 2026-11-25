/**
 * Admin insights: the figures behind Admin > Analytics and the model data on Admin > ADCode
 * models, and every export from those pages.
 *
 *   GET  /v1/admin/insights/models?from&to              every model, totals and the previous window
 *   GET  /v1/admin/insights/model?from&to&provider&model&upstream   one model, day by day, errors
 *   POST /v1/admin/insights/models/rebuild               recount today and yesterday now
 *   GET  /v1/admin/insights/website?days                 the website report, whole period
 *   GET  /v1/admin/insights/export?dataset&format&...    CSV or JSON, built here
 *
 * Everything reads summaries: the model figures come from a daily rollup refreshed every ten
 * minutes, the website report from one aggregate query. No request reads raw rows into the
 * Worker, so a 93-day range costs what a 7-day one does. Exports are generated on the server
 * and sent as a file, so the browser only saves bytes.
 *
 * A Web `Request` handler answered before the main router, like adminConsole.ts, so the routes
 * live together here instead of in server.ts.
 */
import { bannedResponse } from "./accountBan.ts";
import { authenticate, type TokenVerifier } from "./auth.ts";
import { corsHeaders } from "./cors.ts";
import type { Clock, Store } from "./store.ts";
import type { AppUsageStore } from "./appUsage.ts";
import { summarizeAppUsage, utcDay } from "./appUsage.ts";
import { parseTagflowConfig, DEFAULT_TAGFLOW_CONFIG } from "./tagflowConfig.ts";
import { parseReportRange } from "./tagflowReports.ts";
import type { ModelReportRange } from "./tagflowReportTypes.ts";
import type { TagflowConfig } from "./tagflowTypes.ts";
import { growthToWire } from "./growth.ts";
import { withNetworkImpressions } from "./networkImpressions.ts";
import { exportFilename, toCsv } from "./csv.ts";
import {
  buildModelDetail, buildModelRows, fillInsightDays, filterModelRows, insightDaysCsv, modelDetailCsv, modelInsightKey, modelRowsCsv,
  parseModelQuery, sortModelRows, type ModelIdentityKey, type RawModelDetail, type RawModelInsights,
} from "./modelInsights.ts";
import { WEBSITE_TABLES, websiteCsv, websiteReportFromSummary, type RawWebsiteSummary, type WebsiteTable } from "./websiteInsights.ts";

/** What the database answers. Each read returns null when its migration is not applied yet. */
export interface AdminInsightsStore {
  models(from: string, to: string): Promise<RawModelInsights | null>;
  model(from: string, to: string, model: ModelIdentityKey): Promise<RawModelDetail | null>;
  website(start: number, end: number): Promise<RawWebsiteSummary | null>;
  rebuild(): Promise<boolean>;
}

export interface AdminInsightsOptions {
  store: Store;
  verifier: TokenVerifier;
  clock: Clock;
  insights: AdminInsightsStore;
  appUsage?: AppUsageStore;
}

export function isAdminInsightsPath(path: string): boolean {
  return path === "/v1/admin/insights/models" || path === "/v1/admin/insights/model" || path === "/v1/admin/insights/models/rebuild" ||
    path === "/v1/admin/insights/website" || path === "/v1/admin/insights/export";
}

const DAY_MS = 86_400_000;
const DATASETS = ["models", "model", "ai-daily", "website", "growth", "features"] as const;
type Dataset = (typeof DATASETS)[number];

/** `days` as the analytics tabs send it: 1-90, default 30. */
export function parseDays(raw: string | null, fallback = 30): number {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= 1 && value <= 90 ? value : fallback;
}

/** The website report's window: `days` whole UTC days ending tonight at midnight, read up to now. */
export function websiteWindow(days: number, now: number): { start: number; end: number } {
  const end = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  return { start: end - days * DAY_MS, end };
}

/** A JSON list of model keys (at most 20), or null for "every model". */
export function parseKeys(raw: string | null): Set<string> | null {
  if (raw === null || raw.length > 8000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.length <= 20 && value.every((key) => typeof key === "string") ? new Set(value as string[]) : null;
  } catch { return null; }
}

const MIGRATION_HINT = "Apply migration 20261120180100_admin_model_insights to the database, then reload.";

export function createAdminInsightsHandler(options: AdminInsightsOptions): (request: Request) => Promise<Response | null> {
  const { store, clock, insights } = options;

  return async (request) => {
    const url = new URL(request.url);
    if (!isAdminInsightsPath(url.pathname)) return null;

    const headers: Record<string, string> = { ...corsHeaders(request.headers.get("origin") ?? undefined), "cache-control": "no-store" };
    const json = (status: number, value: unknown, extra: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(value), { status, headers: { ...headers, "content-type": "application/json", ...extra } });
    const fail = (status: number, code: string, message: string): Response => json(status, { error: code, message });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const auth = await authenticate({ store, verifier: options.verifier, clock }, request.headers.get("authorization") ?? undefined);
    if (!auth.ok && auth.failure === "account-banned") return bannedResponse(headers);
    if (!auth.ok) return fail(401, auth.failure, "Sign in as an administrator.");
    if (!auth.isAdmin) return fail(403, "not-admin", "Administrator access is required.");
    const audit = (action: string): Promise<void> => store.writeAudit({ adminUid: auth.uid, action, subjectUid: "*", at: clock.now() });

    const range = (): ModelReportRange | null => parseReportRange(url.searchParams.get("from"), url.searchParams.get("to"), clock.now());
    const config = async (): Promise<TagflowConfig | null> => {
      try { return parseTagflowConfig((await store.getTagflowConfig())?.config ?? DEFAULT_TAGFLOW_CONFIG); } catch { return null; }
    };
    const identity = (): ModelIdentityKey | null => {
      const provider = url.searchParams.get("provider"), modelId = url.searchParams.get("model"), upstreamModel = url.searchParams.get("upstream");
      if (provider === null || modelId === null || upstreamModel === null) return null;
      if ([provider, modelId, upstreamModel].some((value) => value.length === 0 || value.length > 200)) return null;
      return { provider, modelId, upstreamModel };
    };
    const rangeOf = (r: ModelReportRange) => ({ from: r.from, to: r.to, previousFrom: new Date(r.previousFromAt).toISOString().slice(0, 10), previousTo: new Date(r.fromAt - DAY_MS).toISOString().slice(0, 10) });

    try {
      if (url.pathname === "/v1/admin/insights/models/rebuild") {
        if (request.method !== "POST") return fail(405, "method", "Use POST.");
        await audit("rebuild-model-insights");
        return (await insights.rebuild()) ? json(200, { ok: true, at: clock.now() }) : fail(503, "insights-unavailable", MIGRATION_HINT);
      }
      if (request.method !== "GET") return fail(405, "method", "Use GET.");

      if (url.pathname === "/v1/admin/insights/models") {
        const r = range();
        if (r === null) return fail(400, "bad-range", "Choose valid dates, up to 93 days, ending no later than today (UTC).");
        const [raw, catalogue] = await Promise.all([insights.models(r.from, r.to), config()]);
        if (raw === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
        await audit("read-model-insights");
        return json(200, {
          range: rangeOf(r), refreshedAt: raw.refreshedAt, coverageFrom: raw.coverageFrom, generatedAt: clock.now(),
          users: raw.users, previousUsers: raw.previousUsers, rows: buildModelRows(raw, catalogue), daily: fillInsightDays(raw.daily, r),
        });
      }

      if (url.pathname === "/v1/admin/insights/model") {
        const r = range(), id = identity();
        if (r === null) return fail(400, "bad-range", "Choose valid dates, up to 93 days, ending no later than today (UTC).");
        if (id === null) return fail(400, "bad-model", "Choose a model from the list.");
        const raw = await insights.model(r.from, r.to, id);
        if (raw === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
        await audit("read-model-insight");
        return json(200, { range: rangeOf(r), key: modelInsightKey(id), ...id, modelName: raw.modelName, generatedAt: clock.now(), ...buildModelDetail(raw, r) });
      }

      if (url.pathname === "/v1/admin/insights/website") {
        const days = parseDays(url.searchParams.get("days"));
        const report = await websiteReport(days);
        if (report === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
        await audit("read-website-insights");
        return json(200, report);
      }

      // ── Exports ────────────────────────────────────────────────────────────────────────
      const dataset = url.searchParams.get("dataset") as Dataset | null;
      if (dataset === null || !DATASETS.includes(dataset)) return fail(400, "bad-dataset", `Choose one of: ${DATASETS.join(", ")}.`);
      const format = url.searchParams.get("format") === "json" ? "json" : "csv";
      const file = (name: string[], csv: () => string, value: unknown): Response => {
        const filename = exportFilename(["adcode", ...name], format);
        return new Response(format === "csv" ? csv() : JSON.stringify(value, null, 2), {
          status: 200,
          headers: { ...headers, "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
        });
      };
      await audit(`export-${dataset}`);

      if (dataset === "models" || dataset === "ai-daily" || dataset === "model") {
        const r = range();
        if (r === null) return fail(400, "bad-range", "Choose valid dates, up to 93 days, ending no later than today (UTC).");
        if (dataset === "model") {
          const id = identity();
          if (id === null) return fail(400, "bad-model", "Choose a model from the list.");
          const raw = await insights.model(r.from, r.to, id);
          if (raw === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
          const detail = buildModelDetail(raw, r);
          const named = { ...id, name: raw.modelName ?? id.modelId };
          return file(["model", id.modelId, r.from, r.to], () => modelDetailCsv(named, detail, r), { range: rangeOf(r), ...named, ...detail });
        }
        const [raw, catalogue] = await Promise.all([insights.models(r.from, r.to), config()]);
        if (raw === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
        if (dataset === "ai-daily") {
          const daily = fillInsightDays(raw.daily, r);
          return file(["ai-usage-daily", r.from, r.to], () => insightDaysCsv(daily), { range: rangeOf(r), refreshedAt: raw.refreshedAt, users: raw.users, daily });
        }
        const query = parseModelQuery(url.searchParams);
        // `keys`: exactly these models, as the comparison chose them.
        const only = parseKeys(url.searchParams.get("keys"));
        const listed = buildModelRows(raw, catalogue).filter((row) => only === null || only.has(row.key));
        const rows = sortModelRows(filterModelRows(listed, query.filter), query.sort, query.direction);
        return file(["models", r.from, r.to], () => modelRowsCsv(rows, r), { range: rangeOf(r), refreshedAt: raw.refreshedAt, filter: query.filter, sort: query.sort, direction: query.direction, rows });
      }

      if (dataset === "website") {
        const days = parseDays(url.searchParams.get("days"));
        const table = (url.searchParams.get("table") ?? "all") as WebsiteTable;
        if (!WEBSITE_TABLES.includes(table)) return fail(400, "bad-table", `Choose one of: ${WEBSITE_TABLES.join(", ")}.`);
        const report = await websiteReport(days);
        if (report === null) return fail(503, "insights-unavailable", MIGRATION_HINT);
        return file(["website", table, `${days}-days`, new Date(report.start).toISOString().slice(0, 10)], () => websiteCsv(report, table), table === "all" ? report : { start: report.start, end: report.end, [table]: (report as Record<string, unknown>)[table] });
      }

      if (dataset === "growth") {
        const now = clock.now();
        const [stats, network] = await Promise.all([store.growthStats(now), store.networkImpressions?.summary(now).catch(() => null) ?? Promise.resolve(null)]);
        const growth = { ...growthToWire(withNetworkImpressions(stats, network)), asOf: now };
        return file(["growth", utcDay(now)], () => toCsv([
          ["section", "date_utc", "metric", "value"],
          ...growth.daily.flatMap((day) => [["daily", day.day, "active", day.active], ["daily", day.day, "new", day.joined], ["daily", day.day, "ads_shown", day.adsShown], ...(day.returning === null ? [] : [["daily", day.day, "came_back", day.returning]])]),
          ...growth.cohorts.flatMap((cohort) => [["cohort", cohort.weekStart, "joined", cohort.joined], ["cohort", cohort.weekStart, "back_after_1_day", cohort.back1d], ["cohort", cohort.weekStart, "back_after_7_days", cohort.back7d]]),
          ...([["developers", growth.developers], ["active_24h", growth.active1d], ["active_7d", growth.active7d], ["active_30d", growth.active30d], ["ads_shown", growth.adsShown], ["clicks", growth.clicks], ["earned_usd", Number(growth.creditedMicros) / 1e6]] as const).map(([metric, value]) => ["total", utcDay(now), metric, value]),
        ]), growth);
      }

      // features
      if (options.appUsage === undefined) return fail(503, "usage-unavailable", "Desktop feature counts are not connected.");
      const days = parseDays(url.searchParams.get("days"));
      const endDay = utcDay(clock.now() + DAY_MS), startDay = utcDay(clock.now() - (days - 1) * DAY_MS);
      const rows = await options.appUsage.read(startDay, endDay);
      const summary = summarizeAppUsage(rows, startDay, endDay);
      // Every feature, not only the top and rare lists the page shows.
      const totals = new Map<string, { uses: number; clientDays: number }>();
      for (const row of rows) { const entry = totals.get(row.name) ?? { uses: 0, clientDays: 0 }; entry.uses += row.uses; entry.clientDays += row.clients; totals.set(row.name, entry); }
      const all = [...totals].sort((a, b) => b[1].uses - a[1].uses || a[0].localeCompare(b[0]));
      return file(["desktop-features", startDay, `${days}-days`], () => toCsv([
        ["from_utc", "to_utc", "kind", "feature", "uses", "install_days"],
        ...all.map(([name, entry]) => [startDay, utcDay(clock.now()), name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1), entry.uses, entry.clientDays]),
      ]), { from: startDay, to: utcDay(clock.now()), summary, all: all.map(([name, entry]) => ({ name, ...entry })) });
    } catch {
      return fail(503, "insights-failed", "The database did not answer in time. Retry in a moment.");
    }
  };

  async function websiteReport(days: number) {
    const now = clock.now();
    const { start, end } = websiteWindow(days, now);
    // The previous window: the same length, shifted back one day, ending at this time yesterday.
    const baselineStart = start - DAY_MS, baselineEnd = now + 1 - DAY_MS;
    const baselineAvailable = baselineStart >= now - 90 * DAY_MS;
    const [current, baseline] = await Promise.all([
      insights.website(start, now + 1),
      baselineAvailable ? insights.website(baselineStart, baselineEnd).catch(() => null) : Promise.resolve(null),
    ]);
    if (current === null) return null;
    const report = websiteReportFromSummary(current, start, end);
    const previous = baseline === null ? null : websiteReportFromSummary(baseline, baselineStart, baselineEnd);
    return {
      ...report, generatedAt: now, days,
      dayComparison: {
        asOf: baselineEnd,
        reason: !baselineAvailable ? "retention-limit" : previous === null ? "unavailable" : null,
        previous: previous === null ? null : { pageViews: previous.pageViews, sessions: previous.sessions, installSessions: previous.installSessions, errorCount: previous.errorCount },
      },
    };
  }
}
