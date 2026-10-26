// Holds the status-alert SQL to its promises, in a real Postgres.
//
// Replays every migration into PGlite, then drives the public status subscription (20261021150000)
// through the functions the API calls: double opt-in, the per-address and per-day confirmation
// limits, confirming, queueing an alert once per ref to the right list, the sending switch and the
// alerts' daily cap, stale alerts, the one-click unsubscribe, and a bounce taking an address off.
//
// No test in `npm run verify` can execute SQL; run this after any change to these functions.
//
//   node scripts/check-status-subscribers-sql.mjs .
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

const T0 = Date.parse("2026-10-21T09:00:00Z");
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const subscribe = (email, models, incidents, now) => one(`select * from public.status_subscribe($1,$2,$3,$4)`, [email, models, incidents, now]);

// Asking: one confirmation, then quiet for two minutes, and never more than five a day.
const first = await subscribe("Ana@Example.test", true, false, T0);
assert.equal(first.send, true);
assert.ok(first.confirm_token);
const row = await one(`select email, state, models, pending_models from public.status_subscribers`);
assert.deepEqual(row, { email: "ana@example.test", state: "pending", models: false, pending_models: true });
assert.equal((await subscribe("ana@example.test", true, true, T0 + 60_000)).send, false, "a second ask inside two minutes sends nothing");
const again = await subscribe("ana@example.test", true, true, T0 + 180_000);
assert.equal(again.send, true);
assert.equal(again.confirm_token, first.confirm_token, "the earlier email's link keeps working");
for (let i = 2; i < 5; i += 1) assert.equal((await subscribe("ana@example.test", true, true, T0 + i * 300_000)).send, true);
assert.equal((await subscribe("ana@example.test", true, true, T0 + 2_000_000)).send, false, "five confirmations a day at most");
await assert.rejects(db.query(`select * from public.status_subscribe('x@example.test', false, false, $1)`, [T0]), /no-topic/);
console.log("subscribe: double opt-in, two-minute gap, five a day");

// Nothing is active until the link is clicked; an unknown link is invalid, an old one expired.
assert.equal((await one(`select public.status_confirm(gen_random_uuid(), $1) as r`, [T0])).r, "invalid");
const late = await subscribe("late@example.test", true, false, T0);
assert.equal((await one(`select public.status_confirm($1, $2) as r`, [late.confirm_token, T0 + 8 * 86_400_000])).r, "expired");
assert.equal((await one(`select public.status_confirm($1, $2) as r`, [first.confirm_token, T0 + 3_000_000])).r, "confirmed");
const ana = await one(`select state, models, incidents, confirm_token, manage_token from public.status_subscribers where email='ana@example.test'`);
assert.equal(ana.state, "active");
assert.equal(ana.models, true);
assert.equal(ana.incidents, true, "the newest request's lists apply");
assert.equal(ana.confirm_token, null, "a link works once");
console.log("confirm: once, within a week");

// A models-only subscriber, and one who bounced.
const bob = await subscribe("bob@example.test", true, false, T0);
await db.query(`select public.status_confirm($1, $2)`, [bob.confirm_token, T0]);
const cat = await subscribe("cat@example.test", true, true, T0);
await db.query(`select public.status_confirm($1, $2)`, [cat.confirm_token, T0]);
await db.query(`insert into public.email_suppressions values('cat@example.test','bounce',$1)`, [T0]);
assert.equal((await subscribe("cat@example.test", true, false, T0 + 999_999)).send, false, "a bounced address gets no confirmation");

const payload = JSON.stringify({ title: "Qwen is having trouble", summary: "12% failed.", status: "degraded", url: "https://adcode.bluethenics.com/status" });
const T1 = T0 + 3_600_000;
assert.equal((await one(`select public.status_queue_alert('models','tagflow:qwen:degraded:1',$1,$2,$3) as n`, ["Degraded: Qwen", payload, T1])).n, 2, "models list, without the bounced address");
assert.equal((await one(`select public.status_queue_alert('models','tagflow:qwen:degraded:1',$1,$2,$3) as n`, ["Degraded: Qwen", payload, T1])).n, -1, "once per ref");
assert.equal((await one(`select public.status_queue_alert('incidents','inc-1/upd-1',$1,$2,$3) as n`, ["Investigating: x", payload, T1])).n, 1, "incidents list is Ana only");
console.log("queue: right list, suppressions honoured, once per ref");

// The sending switch, then the alerts' own daily cap.
assert.equal((await all(`select * from public.status_claim_alerts($1, 10)`, [T1])).length, 0, "nothing while sending is off");
await db.query(`update public.email_settings set enabled=true, postal_address='1 Example Street, Example City', sender_verified_at=$1, status_alert_daily_limit=2`, [T0]);
const claimed = await all(`select * from public.status_claim_alerts($1, 10)`, [T1]);
assert.equal(claimed.length, 2, "capped at the day's limit");
assert.ok(claimed.every((job) => job.manage_token));
assert.equal((await all(`select * from public.status_claim_alerts($1, 10)`, [T1 + 1])).length, 0);
await db.query(`select public.status_finish_alert($1,'re_1',false,null,$2)`, [claimed[0].id, T1]);
await db.query(`select public.status_finish_alert($1,null,true,'provider-500',$2)`, [claimed[1].id, T1]);
assert.equal((await one(`select status from public.status_alert_jobs where id=$1`, [claimed[1].id])).status, "pending", "a server error retries");
console.log("claim: switch, daily cap, retry");

// Stale: an alert nobody got within six hours is dropped.
await db.query(`update public.email_settings set status_alert_daily_limit=40`);
const stale = await all(`select * from public.status_claim_alerts($1, 10)`, [T1 + 7 * 3_600_000]);
assert.equal(stale.length, 0);
assert.equal(Number((await one(`select count(*) as n from public.status_alert_jobs where last_error='stale'`)).n), 2);
console.log("stale: dropped after six hours");

// Unsubscribe, then a bounce on a sent alert.
assert.equal((await one(`select public.status_unsubscribe($1,$2) as ok`, [ana.manage_token, T1])).ok, true);
assert.equal((await one(`select state, models from public.status_subscribers where email='ana@example.test'`)).state, "unsubscribed");
assert.equal((await one(`select public.status_unsubscribe(gen_random_uuid(),$1) as ok`, [T1])).ok, false);
const sentTo = (await one(`select email from public.status_alert_jobs where provider_id='re_1'`)).email;
await db.query(`select public.email_apply_event('evt-1','email.bounced','re_1',$1)`, [T1]);
assert.equal((await one(`select state from public.status_subscribers where email=$1`, [sentTo])).state, "unsubscribed");
assert.equal((await one(`select reason from public.email_suppressions where email=$1`, [sentTo])).reason, "bounce");
await db.query(`select public.status_record_confirmation('late@example.test','re_c1')`);
await db.query(`select public.email_apply_event('evt-2','email.complained','re_c1',$1)`, [T1]);
assert.equal((await one(`select reason from public.email_suppressions where email='late@example.test'`)).reason, "complaint", "a confirmation's complaint suppresses too");
console.log("unsubscribe and webhook: off the lists, suppressed");

console.log("status subscribers SQL: all checks passed");
