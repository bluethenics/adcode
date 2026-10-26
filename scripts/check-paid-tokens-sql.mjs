// Holds the paid AI token SQL to its promises, in a real Postgres.
//
// Replays every migration into PGlite, then drives the paid-token functions (20261021180000)
// the way the relay and the Dodo webhook call them: the free week then refusal, a purchase
// credited exactly once, purchased tokens charged what was used, two requests racing the last
// tokens, refunds (ours and not ours), reservations made by the older relay, grants and sales.
//
// No test in `npm run verify` can execute SQL; run this after any change to these functions.
//
//   node scripts/check-paid-tokens-sql.mjs .
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const ROOT = process.argv[2] ?? ".";
const MIG = join(ROOT, "supabase/migrations");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create schema cron;
  create table cron.jobs_seen (name text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.jobs_seen values (a, b, c) returning 1::bigint $$;
`);
for (const name of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, name), "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, "");
  try { await db.exec(sql); } catch (error) { console.error(`MIGRATION FAILED: ${name}: ${error.message}`); process.exit(1); }
}
console.log("migrations: all applied");

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const MAX = "9223372036854775807";
const reserve = async (n, tokens, now = 1000) => (await q(`select public.reserve_ai_with_tokens($1::uuid,'u','2026-10-21'::date,1,$2,0,0,${MAX},${MAX},0,$3,0,0,0,18000000,false,true,100) r`, [id(n), tokens, now]))[0].r;
const settle = (n, used) => q(`select public.settle_included_ai($1::uuid,$2,0,0,0,false,false)`, [id(n), used]);
const balance = async () => (await q(`select purchased::int, reserved::int from public.ai_token_balances where uid='u'`))[0];
const week = async () => (await q(`select used_millicredits::int used, reserved_millicredits::int held from public.ai_credit_windows where uid='u' and kind='paid_week'`))[0];
// $10 is 10,000,000 micros: the amount Dodo reports for a 1,000-cent pack.
const event = async (type, webhook, order, payment, amount = 10_000_000, session = null) => (await q(`select public.apply_ai_token_event($1,$2,$3,$4,$5,$6,5) r`, [type, webhook, order, payment, session, amount]))[0].r;

// Free week first, then refusal.
assert.equal(await reserve(1, 100), "ok");
await settle(1, 100);
assert.deepEqual(await week(), { used: 100, held: 0 });
assert.equal(await reserve(2, 10), "paid-limit");
assert.equal((await q(`select count(*)::int n from public.tagflow_reservations where id = $1::uuid`, [id(2)]))[0].n, 0, "a refusal writes no reservation");
console.log("free week: used, then refused");

// A purchase credits once.
await q(`insert into public.ai_token_orders(order_id,uid,pack_id,price_cents,tokens,created_at) values ('ait_1','u','50m',1000,1000,1)`);
assert.equal(await event("purchase", "wh_1", "ait_1", "pay_1"), "credited");
assert.equal(await event("purchase", "wh_1", "ait_1", "pay_1"), "duplicate");
assert.equal(await event("purchase", "wh_2", "ait_1", "pay_1"), "duplicate");
assert.deepEqual(await balance(), { purchased: 1000, reserved: 0 });
assert.equal(await event("purchase", "wh_3", "adv_9", "pay_9"), "not-ai-tokens");
console.log("purchase: credited exactly once");

// Purchased tokens are charged what was used.
assert.equal(await reserve(3, 300), "ok");
assert.deepEqual(await balance(), { purchased: 1000, reserved: 300 });
await settle(3, 250);
assert.deepEqual(await balance(), { purchased: 750, reserved: 0 });
assert.equal((await q(`select count(*)::int n from public.ai_token_ledger where kind='usage' and delta=-250`))[0].n, 1);
await settle(3, 250);
assert.deepEqual(await balance(), { purchased: 750, reserved: 0 }, "settling twice charges once");
console.log("purchased tokens: charged what was used, once");

// Two requests racing the last tokens: both admitted, both charged, nothing lost.
assert.deepEqual(await Promise.all([reserve(4, 500), reserve(5, 500)]), ["ok", "ok"]);
await Promise.all([settle(4, 400), settle(5, 400)]);
assert.deepEqual(await balance(), { purchased: -50, reserved: 0 });
assert.equal(await reserve(6, 1), "paid-limit");
console.log("race: both admitted, sums exact, then refused");

// Refunds: an unknown payment is not ours; ours takes back what is left (here nothing).
assert.equal(await event("refund", "wh_r", "", "pay_x"), "not-ai-tokens");
assert.equal(await event("refund", "wh_r2", "", "pay_1"), "refunded");
assert.equal(await event("refund", "wh_r3", "", "pay_1"), "duplicate");
assert.equal((await q(`select status from public.ai_token_orders where order_id='ait_1'`))[0].status, "refunded");
assert.deepEqual(await balance(), { purchased: -50, reserved: 0 });
console.log("refunds: ours once, others passed on");

// The older relay's reservations settle exactly as before.
await q(`select public.reserve_unlimited_ai($1::uuid,'old','2026-10-21'::date,1,10,0,0,${MAX},${MAX},0,1000,0,0,0,18000000,false)`, [id(7)]);
await settle(7, 10);
assert.equal((await q(`select count(*)::int n from public.ai_token_ledger where uid='old'`))[0].n, 0);
assert.equal((await q(`select input_tokens::int n from public.tagflow_usage where uid='old'`))[0].n, 10);
console.log("older relay: settles as before");

// A new week brings the free allowance back.
assert.equal(await reserve(8, 50, 1000 + 604800000), "ok");
console.log("free week: refills after seven days");

// Grants and sales.
await q(`select public.grant_ai_tokens('u', 500, 'admin-1', 'outage', 7)`);
assert.deepEqual(await balance(), { purchased: 450, reserved: 0 });
await assert.rejects(q(`select public.grant_ai_tokens('u', 0, 'admin-1', '', 7)`), /Invalid grant/);
const sales = await q(`select * from public.ai_token_sales(0)`);
assert.ok(sales.length >= 1);
assert.equal(sales.reduce((sum, row) => sum + Number(row.revenue_cents), 0), 1000);
console.log("grants and sales: as expected");

// Lock order. PGlite has one connection, so it cannot deadlock - the order is checked instead.
// settle_included_ai locks usage, then the credit windows, then the paid week, then the balance;
// a reserve that took the paid week first could wait on a settle that waits on it.
const source = (await q(`select prosrc from pg_proc where proname = 'reserve_ai_with_tokens'`))[0].prosrc;
const firstUsageLock = source.indexOf("from public.tagflow_usage");
const firstWeekLock = source.indexOf("kind = 'paid_week' for update");
assert.ok(firstUsageLock > 0 && firstWeekLock > 0 && firstUsageLock < firstWeekLock, "reserve locks the usage row before the paid week, as settle does");
assert.ok(source.indexOf("kind in ('session', 'week')") > 0 && source.indexOf("kind in ('session', 'week')") < firstWeekLock, "and the credit windows before the paid week");
console.log("lock order: matches settle");

// The relay always sends p_metered = true; the paid hold works there too.
const metered = async (n, tokens, uid = "m") => (await q(`select public.reserve_ai_with_tokens($1::uuid,$2,'2026-10-21'::date,1,$3,0,0,${MAX},${MAX},0,1000,$3,10000000,10000000,18000000,true,true,100) r`, [id(n), uid, tokens]))[0].r;
assert.equal(await metered(20, 60), "ok");
assert.equal(await metered(21, 60), "ok");
console.log("metered: holds alongside the credit windows");

// An answer that came from a free model releases the paid holds without charging them.
await q(`select public.grant_ai_tokens('f', 1000, 'admin-1', '', 1)`);
await q(`select public.reserve_ai_with_tokens($1::uuid,'f','2026-10-21'::date,1,500,0,0,${MAX},${MAX},0,1000,0,0,0,18000000,false,true,100)`, [id(30)]);
await q(`select public.settle_ai_with_tokens($1::uuid,450,0,0,0,false,false,0)`, [id(30)]);
assert.deepEqual((await q(`select purchased::int, reserved::int from public.ai_token_balances where uid='f'`))[0], { purchased: 1000, reserved: 0 });
assert.deepEqual((await q(`select used_millicredits::int used, reserved_millicredits::int held from public.ai_credit_windows where uid='f' and kind='paid_week'`))[0], { used: 0, held: 0 });
console.log("fallback to a free model: holds released, nothing charged");

// A payment that does not match its order is held for review, never credited.
await q(`insert into public.ai_token_orders(order_id,uid,pack_id,price_cents,tokens,checkout_session,created_at) values ('ait_2','v','50m',1000,1000,'cs_2',1), ('ait_3','v','50m',1000,1000,'cs_3',1)`);
assert.equal(await event("purchase", "wh_v1", "ait_2", "pay_v1", 1_000_000, "cs_2"), "review");
assert.equal(await event("purchase", "wh_v2", "ait_3", "pay_v2", 10_000_000, "cs_other"), "review");
assert.equal((await q(`select count(*)::int n from public.ai_token_balances where uid='v' and purchased > 0`))[0].n, 0);
assert.equal((await q(`select count(*)::int n from public.provider_events where status = 'review_required' and order_id in ('ait_2','ait_3')`))[0].n, 2);
console.log("mismatched payment: held for review");

// A chargeback takes back what is left; a won dispute gives it back.
await q(`insert into public.ai_token_orders(order_id,uid,pack_id,price_cents,tokens,checkout_session,created_at) values ('ait_4','d','50m',1000,1000,'cs_4',1)`);
assert.equal(await event("purchase", "wh_d1", "ait_4", "pay_d", 10_000_000, "cs_4"), "credited");
assert.equal(await event("dispute-opened", "wh_d2", "", "pay_d"), "refunded");
assert.equal((await q(`select purchased::int n from public.ai_token_balances where uid='d'`))[0].n, 0);
assert.equal((await q(`select status from public.ai_token_orders where order_id='ait_4'`))[0].status, "disputed");
assert.equal(await event("dispute-release", "wh_d3", "", "pay_d"), "credited");
assert.equal((await q(`select purchased::int n from public.ai_token_balances where uid='d'`))[0].n, 1000);
assert.equal((await q(`select status from public.ai_token_orders where order_id='ait_4'`))[0].status, "paid");
console.log("disputes: taken back, then given back when won");

console.log("paid AI tokens SQL: all checks passed");
