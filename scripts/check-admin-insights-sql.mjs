// Runs the admin insights migrations in a real Postgres (PGlite) and checks their numbers
// against the TypeScript the old paths used.
//
// The route tests run on fakes; this is the one check of the SQL that ships. It proves:
//   * the daily rollup adds up to the raw requests - totals, distinct users over a range,
//     cached tokens, wallet revenue, error codes - and leaves admin tests out;
//   * the time-to-first-token histogram is the TypeScript histogram, bucket for bucket;
//   * re-running a day replaces it rather than adding to it;
//   * read_website_analytics_summary, turned into a report by websiteReportFromSummary, equals
//     summarizeWebsiteEvents over the same events - with no 20,000-event cap.
//
//   node scripts/check-admin-insights-sql.mjs
// (@electric-sql/pglite must be installed: npm install --no-save @electric-sql/pglite)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { summarizeWebsiteEvents } from "../services/api/src/websiteAnalytics.ts";
import { websiteReportFromSummary } from "../services/api/src/websiteInsights.ts";
import { firstTokenBucket, histogramPercentile, mergeHistograms } from "../services/api/src/modelInsights.ts";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
  create function cron.unschedule(p_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = p_id returning true $$;
  create table public.ai_model_requests (
    id uuid primary key, uid text not null, model_id text not null, model_name text not null, provider text not null,
    upstream_model text not null, started_at bigint not null, finished_at bigint, provider_started_at bigint, outcome text not null,
    error_code text, upstream_status integer, source text not null, streamed boolean, tools_offered boolean, tool_calls integer,
    finish_reason text, context_window bigint, requested_output bigint, estimated_input bigint, input_tokens bigint not null default 0,
    output_tokens bigint not null default 0, cost_micros bigint not null default 0, estimated boolean not null default false,
    duration_ms bigint, first_token_ms bigint, country text, ai_persona text, use_case text, platform text
  );
  create index ai_model_requests_period on public.ai_model_requests (started_at);
  create table public.model_wallet_ledger (id uuid primary key, uid text, delta_micros bigint, kind text, ref text, model text, estimated boolean, created_at bigint);
  create table public.website_events (id uuid primary key, session uuid, name text, path text, source text, campaign text, device text,
    value double precision, received_at bigint, placement text, occurred_at bigint);
`);

// A small deterministic generator, so a failure reproduces.
let seed = 20261120;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (items) => items[Math.floor(random() * items.length)];
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const DAY = 86_400_000;
const day0 = Date.parse("2026-11-17T00:00:00Z");
const models = [["tagflow", "tagflow-code", "coder-27b"], ["heabsy", "glm-5", "glm-5"], ["openrouter", "deepseek-v4", "deepseek/v4"]];
const outcomes = ["success", "success", "success", "success", "provider_error", "relay_error", "rejected", "cancelled", "pending"];
const requests = [];
for (let i = 0; i < 4000; i += 1) {
  const [provider, model_id, upstream_model] = pick(models);
  const started_at = day0 + Math.floor(random() * 3 * DAY);
  const outcome = pick(outcomes);
  const cached = i >= 1500 && random() < 0.8 ? Math.floor(random() * 500) : null;
  requests.push({
    id: uuid(i + 1), uid: `u${Math.floor(random() * 120)}`, model_id, model_name: `${model_id} name`, provider, upstream_model, started_at,
    provider_started_at: outcome === "rejected" ? null : started_at + 5, outcome,
    error_code: outcome === "provider_error" ? pick(["rate_limit", "server"]) : outcome === "relay_error" ? "timeout" : null,
    upstream_status: outcome === "provider_error" ? pick([429, 500]) : null, source: random() < 0.05 ? "admin-test" : "chat",
    input_tokens: Math.floor(random() * 5000), output_tokens: Math.floor(random() * 900), cost_micros: Math.floor(random() * 3000),
    estimated: random() < 0.1, first_token_ms: outcome === "success" && random() < 0.9 ? Math.floor(20 + random() * random() * 20000) : null,
    cached_input_tokens: cached,
  });
}
const insert = async (rows, withCached) => {
  for (const r of rows) {
    const columns = ["id", "uid", "model_id", "model_name", "provider", "upstream_model", "started_at", "provider_started_at", "outcome", "error_code", "upstream_status", "source", "input_tokens", "output_tokens", "cost_micros", "estimated", "first_token_ms", ...(withCached ? ["cached_input_tokens"] : [])];
    await db.query(`insert into public.ai_model_requests (${columns.join(",")}) values (${columns.map((_, n) => `$${n + 1}`).join(",")})`, columns.map((c) => r[c]));
  }
};
// Rows from before the cached column existed, then the migration that adds it, then the rest.
await insert(requests.slice(0, 1500), false);
await db.exec(readFileSync("supabase/migrations/20261120180000_ai_model_cached_tokens.sql", "utf8"));
await insert(requests.slice(1500), true);
for (let i = 0; i < 30; i += 1) {
  await db.query("insert into public.model_wallet_ledger values ($1,$2,$3,'usage',$4,'deepseek-v4',false,$5)", [uuid(90000 + i), "u1", -1000 * (i + 1), uuid(i), day0 + i * 7_000_000]);
}
await db.query("insert into public.model_wallet_ledger values ($1,'u1',5000000,'purchase','p',null,false,$2)", [uuid(99999), day0]);

const events = [];
const names = ["page_view", "page_view", "page_view", "install_copy", "download_click", "advertise_click", "campaign_created", "js_error", "engagement", "LCP", "CLS", "INP", "scroll_50"];
const sessions = Array.from({ length: 900 }, (_, n) => uuid(500000 + n));
const end = day0 + 3 * DAY;
for (let i = 0; i < 25000; i += 1) {
  const name = pick(names);
  const occurredAt = day0 - DAY + Math.floor(random() * 4.5 * DAY);
  events.push({ id: uuid(1000000 + i), session: pick(sessions), name, path: pick(["/", "/versions", "/docs/installing-adcode", "/portal", "/pricing", "/i/abc", "/portal/campaigns/new"]),
    source: pick(["x", "t.co", "twitter", "google.com", "www.google.com", "news.ycombinator.com", "", "direct"]), campaign: pick(["", "launch", "nov"]),
    device: pick(["desktop", "mobile", "tablet"]), value: name === "engagement" ? Math.floor(random() * 60000) : name === "CLS" ? random() : Math.floor(random() * 4000),
    receivedAt: occurredAt + Math.floor(random() * 60_000), occurredAt, placement: pick(["", "hero", "closing"]) });
}
for (const e of events) {
  await db.query("insert into public.website_events values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [e.id, e.session, e.name, e.path, e.source, e.campaign, e.device, e.value, e.receivedAt, e.placement, e.occurredAt]);
}

await db.exec(readFileSync("supabase/migrations/20261120180100_admin_model_insights.sql", "utf8"));
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

// ── The rollup adds up ────────────────────────────────────────────────────────────────────
const customers = requests.filter((r) => r.source !== "admin-test");
const span = await one("select read_ai_model_insights('2026-11-17', '2026-11-19') as r");
const report = span.r;
assert.equal(report.models.reduce((n, m) => n + m.current.requests, 0), customers.length, "every customer request is counted once");
assert.equal(report.users, new Set(customers.map((r) => r.uid)).size, "users over the range are distinct, not summed per day");
for (const [provider, model_id, upstream_model] of models) {
  const rows = customers.filter((r) => r.provider === provider && r.model_id === model_id);
  const got = report.models.find((m) => m.modelId === model_id);
  assert.ok(got, `${model_id} reported`);
  const c = got.current;
  assert.equal(c.requests, rows.length);
  assert.equal(c.users, new Set(rows.map((r) => r.uid)).size, `${model_id} distinct users`);
  assert.equal(c.successes, rows.filter((r) => r.outcome === "success").length);
  assert.equal(c.providerErrors, rows.filter((r) => r.outcome === "provider_error").length);
  assert.equal(c.cancelled, rows.filter((r) => r.outcome === "cancelled").length);
  assert.equal(c.unfinished, rows.filter((r) => r.outcome === "pending").length);
  assert.equal(c.inputTokens, rows.reduce((n, r) => n + r.input_tokens, 0));
  assert.equal(c.cachedInputTokens, rows.reduce((n, r) => n + (r.cached_input_tokens ?? 0), 0));
  assert.equal(c.cacheMeasuredInputTokens, rows.filter((r) => r.cached_input_tokens !== null).reduce((n, r) => n + r.input_tokens, 0), "cached share counts only measured requests");
  assert.equal(c.costMicros, rows.reduce((n, r) => n + r.cost_micros, 0));
  const hist = mergeHistograms([rows.filter((r) => r.outcome === "success" && r.first_token_ms !== null).reduce((h, r) => { h[firstTokenBucket(r.first_token_ms)] += 1; return h; }, new Array(64).fill(0))]);
  assert.deepEqual(c.firstTokenHistogram, hist, `${model_id} histogram matches TypeScript`);
  const exact = rows.filter((r) => r.outcome === "success" && r.first_token_ms !== null).map((r) => r.first_token_ms).sort((a, b) => a - b);
  const median = exact[Math.ceil(exact.length / 2) - 1];
  assert.ok(Math.abs(histogramPercentile(hist, 0.5) - median) / median < 0.12, `${model_id} median within a bucket (${histogramPercentile(hist, 0.5)} vs ${median})`);
  assert.equal(c.revenueMicros, model_id === "deepseek-v4" ? 465000 : 0, "wallet revenue goes to the model that charged it");
}
const detail = (await one("select read_ai_model_insight('2026-11-18', '2026-11-18', 'heabsy', 'glm-5', 'glm-5') as r")).r;
const glmDay = customers.filter((r) => r.model_id === "glm-5" && r.started_at >= day0 + DAY && r.started_at < day0 + 2 * DAY);
assert.equal(detail.daily.length, 1);
assert.equal(detail.daily[0].requests, glmDay.length);
assert.equal(detail.users, new Set(glmDay.map((r) => r.uid)).size);
assert.equal(detail.errors.reduce((n, e) => n + Number(e.requests), 0), glmDay.filter((r) => r.error_code !== null).length, "errors add up");
const glmBefore = customers.filter((r) => r.model_id === "glm-5" && r.started_at >= day0 && r.started_at < day0 + DAY);
assert.equal(detail.previousDaily.reduce((n, d) => n + d.requests, 0), glmBefore.length, "previous window is the day before");

// Running a day twice replaces it.
await db.query("select refresh_ai_model_daily('2026-11-18')");
await db.query("select refresh_ai_model_daily('2026-11-18')");
assert.equal((await one("select read_ai_model_insights('2026-11-17', '2026-11-19') as r")).r.models.reduce((n, m) => n + m.current.requests, 0), customers.length, "refresh is idempotent");
assert.ok((await one("select refreshed_at from ai_model_daily_state where id = 1")).refreshed_at > 0, "state row written");
assert.equal((await one("select count(*)::int as n from cron.job where jobname = 'ai-model-daily'")).n, 1, "cron job scheduled once");

// ── Website: SQL summary equals the TypeScript report, uncapped ──────────────────────────────
const normalise = (r) => ({ ...r, truncated: false, pages: [...r.pages].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  ...Object.fromEntries(["sources", "campaigns", "devices", "events", "placements", "invitePages"].map((k) => [k, [...r[k]].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))])) });
const raw = (await one("select read_website_analytics_summary($1, $2) as r", [day0, end])).r;
const fromSql = websiteReportFromSummary(raw, day0, end);
const fromTs = summarizeWebsiteEvents(events, day0, end, false);
assert.ok(fromTs.totalEvents > 15000, "enough events to matter");
assert.deepEqual(normalise(fromSql), normalise(fromTs), "SQL website summary matches summarizeWebsiteEvents");

console.log(`admin insights SQL: ok (${customers.length} requests, ${fromTs.totalEvents} website events)`);
