/**
 * How long the retention rollup and summary take at scale, in PGlite (slower than the real
 * database, so an upper bound). `node scripts/bench-retention-sql.mjs [events] [accounts]`.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const EVENTS = Number(process.argv[2] ?? 1_000_000), ACCOUNTS = Number(process.argv[3] ?? 20_000);
const DAY = 86_400_000, NOW = Date.UTC(2026, 10, 20, 12);
const NAMES = ["day_active", "ai_message", "ai_turn_ok", "turn_failed", "project_opened", "edit_applied", "session_end", "limit_reached", "turn_cancelled", "first_launch"];
const CODES = { turn_failed: ["auth", "network", "server"], session_end: ["quit", "unclean"], limit_reached: ["daily"], project_opened: ["folder"], edit_applied: ["automatic"] };
const db = new PGlite();
const time = async (label, run) => { const start = performance.now(); const out = await run(); console.log(`${label}: ${((performance.now() - start) / 1000).toFixed(1)} s`); return out; };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as 'insert into cron.job (jobname) values (n) returning jobid';
    create function cron.unschedule(id bigint) returns boolean language sql as 'select true';`);
  await db.exec(readFileSync("supabase/migrations/20261120120000_retention_tracking.sql", "utf8"));
  await time(`insert ${EVENTS.toLocaleString()} events for ${ACCOUNTS.toLocaleString()} accounts`, () => db.query(`
    insert into public.retention_events (uid, name, code, ms, at, received_at)
    select 'u' || (g % $2), (array[${NAMES.map((n) => `'${n}'`).join(",")}])[1 + (g::bigint * 7919 % ${NAMES.length})::int], null, null,
           $3::bigint - (g % 85) * ${DAY}::bigint - (g % 1000), $3::bigint - 3600000
      from generate_series(1, $1) g`, [EVENTS, ACCOUNTS, NOW]));
  for (const [name, codes] of Object.entries(CODES)) await db.query(`update public.retention_events set code = (array[${codes.map((c) => `'${c}'`).join(",")}])[1 + id % ${codes.length}] where name = '${name}'`);
  await time("first full rollup + four summaries", () => db.query("select public.refresh_retention($1)", [NOW]));
  await db.query(`insert into public.retention_events (uid, name, at, received_at) select 'u' || g, 'day_active', $1::bigint - 1000, $1::bigint - 3600000 from generate_series(1, 5000) g`, [NOW]);
  await time("hourly refresh with 5,000 new events", () => db.query("select public.refresh_retention($1)", [NOW + 60_000]));
  await time("read cached summary", () => db.query("select public.read_retention_summary(7)"));
  await time("read churned page", () => db.query("select public.read_retention_churned($1, 7, null, 0, 50)", [NOW]));
  await time("read one timeline", () => db.query("select public.read_retention_user('u42')"));
} finally { await db.close(); }
