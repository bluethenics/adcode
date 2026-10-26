// Holds the AI plans SQL to its promises, in a real Postgres.
//
// Replays every migration into PGlite, then drives the plan functions (20261024140000) the way the
// relay, the Dodo webhook and the admin routes call them: subscriptions applied once and lasting
// until their period end, gifts and boosts for one person or everyone, promo codes (limit, expiry,
// once per account), Pro invites rewarded once, week resets, and the subscriber summary.
//
// No test in npm run verify can execute SQL; run this after any change to these functions.
//
//   node scripts/check-ai-plans-sql.mjs .
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
const one = async (sql, params = []) => (await q(sql, params))[0];
const DAY = 86_400_000;
const sub = async (webhook, type, subscription, uid, plan, periodEnd = 30 * DAY, now = DAY, occurredAt = null, customer = "cus_1") => {
  if (uid !== null) await q(`insert into public.users(uid,created_at) values ($1,0) on conflict do nothing`, [uid]);
  return one(`select public.apply_ai_subscription_event_v2($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10) r`, [webhook, type, subscription, uid, plan, customer, type, periodEnd, now, occurredAt]).then((row) => row.r);
};
const state = (uid, now) => one(`select * from public.ai_plan_state($1,$2)`, [uid, now]);
const purchased = async (uid) => Number((await one(`select coalesce((select purchased from public.ai_token_balances where uid=$1),0) n`, [uid])).n);

// Subscriptions: once, until the period end; cancelled keeps access; failed ends it; no uid -> review.
assert.equal(await sub("wh1", "active", "sub_1", "u", "monthly"), "applied");
assert.equal(await sub("wh1", "active", "sub_1", "u", "monthly"), "duplicate");
assert.equal((await state("u", 2 * DAY)).plan, "monthly");
assert.equal((await state("u", 31 * DAY)).plan, null);
assert.equal(await sub("wh2", "cancelled", "sub_1", "u", "monthly", 30 * DAY, 2 * DAY), "applied");
assert.equal((await state("u", 3 * DAY)).plan, "monthly");
assert.equal(await sub("wh3", "failed", "sub_1", "u", "monthly", 30 * DAY, 4 * DAY), "applied");
assert.equal((await state("u", 5 * DAY)).plan, null);
assert.equal(await sub("wh4", "active", "sub_x", null, "monthly"), "review");
assert.equal(await sub("wh5", "active", "sub_y", "u", null), "review");
assert.equal((await one(`select count(*)::int n from public.provider_events where status='review_required' and event_type like 'ai-sub-%'`)).n, 2);
console.log("subscriptions: once, until period end, review without uid");

// Gifts and boosts, one person or everyone; the best plan wins.
await q(`insert into public.ai_plan_gifts(uid, plan, starts_at, ends_at, source, created_at) values ('*','weekly',0,$1,'admin',0)`, [7 * DAY]);
await q(`insert into public.ai_boosts(uid, weekly_tokens, starts_at, ends_at, created_by) values ('g',90000000,0,$1,'admin')`, [3 * DAY]);
const other = await state("other", DAY);
assert.equal(other.plan, "weekly");
assert.equal(other.source, "gift");
assert.equal(Number(other.boost_tokens), 0);
assert.equal(Number((await state("g", DAY)).boost_tokens), 90000000);
assert.equal((await state("g", 8 * DAY)).plan, null);
await sub("wh6", "active", "sub_p0", "best", "pro");
assert.equal((await state("best", DAY)).plan, "pro", "pro beats everyone's weekly gift");
console.log("gifts and boosts: best one wins, everyone rows apply to all");

// Promo codes.
await q(`insert into public.ai_promo_codes(code, kind, tokens, max_redemptions, expires_at, created_by, created_at) values ('ONE','tokens',5,1,$1,'admin',0)`, [10 * DAY]);
const promo = async (code, uid, now) => (await one(`select public.redeem_ai_promo($1,$2,$3) r`, [code, uid, now])).r;
assert.equal(await promo("ONE", "a", DAY), "tokens");
assert.equal(await promo("ONE", "a", DAY), "already");
assert.equal(await promo("ONE", "b", DAY), "used-up");
assert.equal(await promo("NOPE", "b", DAY), "unknown");
assert.equal(await purchased("a"), 5);
assert.equal((await one(`select ref from public.ai_token_ledger where uid='a' and kind='grant'`)).ref, "promo:ONE");
await q(`insert into public.ai_promo_codes(code, kind, plan, days, max_redemptions, expires_at, created_by, created_at) values ('PRO7','plan','pro',7,5,$1,'admin',0)`, [3 * DAY]);
assert.equal(await promo("PRO7", "c", 4 * DAY), "expired");
assert.equal(await promo("PRO7", "d", DAY), "plan");
assert.equal((await state("d", 2 * DAY)).source, "gift");
const race = await Promise.all(["r1", "r2", "r3", "r4", "r5"].map((uid) => promo("PRO7", uid, DAY)));
assert.deepEqual(race.sort(), ["plan", "plan", "plan", "plan", "used-up"]);
console.log("promo codes: limit, expiry, once per account");

// Pro invites: rewarded once per invitee.
await sub("whp", "active", "sub_p", "pro1", "pro");
const invite = await one(`select * from public.ai_invite_for('pro1',$1)`, [DAY]);
assert.equal(invite.uses, 0);
assert.equal(invite.max_uses, 2);
assert.equal((await one(`select * from public.ai_invite_for('pro1',$1)`, [DAY])).code, invite.code);
assert.equal(await one(`select * from public.ai_invite_for('nopro',$1)`, [DAY]), undefined);
const redeem = async (uid) => (await one(`select public.redeem_ai_invite($1,$2,$3) r`, [invite.code, uid, DAY])).r;
assert.equal(await redeem("pro1"), "own-code");
assert.equal(await redeem("friend"), "joined");
assert.equal(await redeem("friend"), "already");
await sub("whf1", "active", "sub_f", "friend", "monthly");
await sub("whf2", "cancelled", "sub_f", "friend", "monthly", 30 * DAY, 2 * DAY);
await sub("whf3", "active", "sub_f2", "friend", "monthly");
assert.equal(await purchased("friend"), 4000000);
assert.equal(await purchased("pro1"), 4000000);
assert.equal(Number((await one(`select count(*) n from public.ai_token_ledger where uid in ('pro1','friend') and kind='grant' and ref='invite:friend'`)).n), 2);
await sub("whx", "active", "sub_x2", "paying", "monthly");
assert.equal(await redeem("paying"), "has-plan");
assert.equal(await redeem("second"), "joined");
assert.equal(await redeem("third"), "used-up");
console.log("invites: rewarded once, two uses");

// Week reset.
const MAX = "9223372036854775807";
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "none");
await q(`select public.reserve_ai_with_tokens('00000000-0000-0000-0000-000000000051'::uuid,'w','2026-10-24'::date,1,10,0,0,${MAX},${MAX},0,1,0,0,0,18000000,false,true,100)`);
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "busy");
await q(`select public.settle_included_ai('00000000-0000-0000-0000-000000000051'::uuid,10,0,0,0,false,false)`);
assert.deepEqual((await q(`select uid from public.ai_credit_windows where kind='paid_week' and uid > '' order by uid limit 10`)).map((row) => row.uid), ["w"]);
assert.equal((await one(`select public.reset_ai_week('w') r`)).r, "reset");
assert.equal((await one(`select count(*)::int n from public.ai_credit_windows where uid='w' and kind='paid_week'`)).n, 0);
console.log("week reset: refused while held, then fresh");

// Summary and indexes.
const summary = await q(`select * from public.ai_subscription_summary($1)`, [2 * DAY]);
assert.ok(summary.some((row) => row.plan === "pro" && Number(row.active) >= 1 && Number(row.mrr_cents) >= 1900));
await q(`insert into public.ai_subscriptions(provider_subscription_id, uid, plan, status, ends_at, updated_at) select 'bulk'||g, 'bulk'||g, 'monthly', 'active', 99, 0 from generate_series(1,1000) g`);
await q(`analyze public.ai_subscriptions`);
const explained = (await q(`explain select 1 from public.ai_subscriptions where uid = 'u' and ends_at > 5`)).map((row) => row["QUERY PLAN"]).join("\n");
assert.ok(!/Seq Scan on ai_subscriptions/.test(explained), `the plan lookup must use an index:\n${explained}`);
console.log("summary and indexes: as expected");

// Hardening: signed provider time, period order and subscription ownership.
await sub("order-new", "renewed", "ordered", "ordered-user", "monthly", 160 * DAY, 130 * DAY, 130 * DAY);
await sub("order-late", "active", "ordered", "ordered-user", "weekly", 130 * DAY, 131 * DAY, 100 * DAY);
assert.equal((await state("ordered-user", 132 * DAY)).plan, "monthly");
assert.equal(Number((await state("ordered-user", 132 * DAY)).ends_at), 160 * DAY);
assert.equal((await one(`select status from public.provider_events where webhook_id='order-late'`)).status, "ignored");
assert.equal(await sub("ownership-user", "active", "ordered", "other-owner", "pro", 160 * DAY, 133 * DAY, 133 * DAY), "review");
assert.equal(await sub("ownership-customer", "active", "ordered", "ordered-user", "pro", 160 * DAY, 133 * DAY, 133 * DAY, "cus_other"), "review");
assert.equal((await state("other-owner", 133 * DAY)).plan, null);
assert.equal((await one(`select public.apply_ai_subscription_event_v2('missing-account','active','missing-sub','does-not-exist','pro','cus_1','active',$1,false,$2,$2) r`, [160 * DAY,130 * DAY])).r, "review");
await sub("terminal-first", "failed", "terminal-sub", "terminal-user", "monthly", 160 * DAY, 130 * DAY, 130 * DAY);
await sub("terminal-late", "active", "terminal-sub", "terminal-user", "monthly", 160 * DAY, 131 * DAY, 129 * DAY);
assert.equal((await state("terminal-user", 132 * DAY)).plan, null);
await sub("terminal-new", "active", "terminal-sub", "terminal-user", "monthly", 160 * DAY, 133 * DAY, 133 * DAY);
assert.equal((await state("terminal-user", 134 * DAY)).plan, "monthly", "a later provider recovery can resume access");
await sub("no-time-stop", "expired", "untimed", "untimed-user", "monthly", 160 * DAY, 130 * DAY);
await sub("no-time-late", "active", "untimed", "untimed-user", "monthly", 160 * DAY, 131 * DAY);
assert.equal((await state("untimed-user", 132 * DAY)).plan, null, "untimed late activation cannot reopen a terminal period");
console.log("event order and ownership: late events ignored, account/customer changes reviewed");

// An expired Pro code cannot be redeemed or rewarded after the inviter's access ends.
await sub("expired-pro-start", "active", "expired-pro", "former-pro", "pro", 110 * DAY, 100 * DAY);
const formerInvite = await one(`select * from public.ai_invite_for('former-pro',$1)`, [101 * DAY]);
assert.equal((await one(`select public.redeem_ai_invite($1,'waiting-friend',$2) r`, [formerInvite.code,102 * DAY])).r, "joined");
assert.equal((await one(`select public.redeem_ai_invite($1,'late-friend',$2) r`, [formerInvite.code,111 * DAY])).r, "unknown");
await sub("expired-pro-friend", "active", "waiting-friend", "waiting-friend", "monthly", 150 * DAY, 112 * DAY);
assert.equal(await purchased("waiting-friend"), 0);
assert.equal(await purchased("former-pro"), 0);
await sub("former-paying", "active", "former-paying", "former-paying", "weekly", 100 * DAY, 90 * DAY);
assert.equal((await one(`select public.redeem_ai_invite($1,'former-paying',$2) r`, [formerInvite.code,103 * DAY])).r, "has-plan");
console.log("invites: live Pro required at redemption and reward, previous subscribers excluded");

// v2 state publishes upcoming starts/ends, so TTL and stale-on-error cannot extend a boost.
await q(`insert into public.ai_boosts(uid,weekly_tokens,starts_at,ends_at,created_by) values ('expiry',90000000,$1,$2,'admin')`, [100 * DAY,102 * DAY]);
assert.equal(Number((await one(`select * from public.ai_plan_state_v2('expiry',$1)`, [99 * DAY])).valid_until), 100 * DAY);
assert.equal(Number((await one(`select * from public.ai_plan_state_v2('expiry',$1)`, [101 * DAY])).valid_until), 102 * DAY);
assert.equal(Number((await one(`select * from public.ai_plan_state_v2('expiry',$1)`, [102 * DAY])).boost_tokens), 0);
assert.equal((await one(`select has_function_privilege('anon','public.ai_plan_state_v2(text,bigint)','execute') allowed`)).allowed, false);
assert.equal((await one(`select has_function_privilege('authenticated','public.apply_ai_subscription_event_v2(text,text,text,text,text,text,text,bigint,boolean,bigint,bigint)','execute') allowed`)).allowed, false);
console.log("snapshot boundaries and RPC permissions: as expected");

// Checkout claims serialize across workers before any hosted payment link is created.
await q(`insert into public.users(uid,created_at) values ('checkout-owner',0),('checkout-other',0) on conflict do nothing`);
const claimCheckout = async (order, plan = "weekly", now = 200 * DAY) => (await one(`select public.claim_ai_plan_checkout('checkout-owner',$1,'US',$2,$3) r`, [plan,order,now])).r;
const claims = await Promise.all(["aip_first","aip_second","aip_third"].map(order => claimCheckout(order)));
assert.equal(claims.filter(c => c.status === "claimed").length, 1);
assert.equal(new Set(claims.map(c => c.checkout.orderId)).size, 1, "all workers share one order");
const checkoutOrder = claims[0].checkout.orderId;
assert.equal((await claimCheckout("aip_different","pro")).checkout.plan, "weekly", "another plan cannot replace a payable checkout");
assert.equal((await one(`select public.complete_ai_plan_checkout('checkout-other',$1,'cks_other','https://checkout.test/other',$2) r`, [checkoutOrder,200 * DAY])).r, "missing");
assert.equal((await one(`select public.complete_ai_plan_checkout('checkout-owner',$1,'cks_one','https://checkout.test/one',$2) r`, [checkoutOrder,200 * DAY])).r, "saved");
const resumed = await claimCheckout("aip_resume");
assert.equal(resumed.status, "existing"); assert.equal(resumed.checkout.checkoutUrl, "https://checkout.test/one");
const expired = await claimCheckout("aip_afterexpiry","monthly",202 * DAY);
assert.equal(expired.status, "claimed"); assert.equal(expired.checkout.checkoutUrl, null);
await sub("checkout-paid","active","checkout-sub","checkout-owner","monthly",240 * DAY,202 * DAY);
assert.equal((await one(`select public.complete_ai_plan_checkout('checkout-owner','aip_afterexpiry','cks_late','https://checkout.test/late',$1) r`, [202 * DAY])).r, "subscribed", "activation before completion cannot reopen checkout");
assert.equal((await claimCheckout("aip_paid","pro",202 * DAY)).status, "subscribed");
for (const status of ["active","pending","on_hold","paused","past_due"]) {
  await q(`update public.ai_subscriptions set status=$1,ends_at=$2 where provider_subscription_id='checkout-sub'`, [status,202 * DAY]);
  assert.equal((await claimCheckout("aip_recovery","pro",203 * DAY)).status, "subscribed", `${status} billing can recover despite suspended access`);
  assert.equal((await one(`select public.complete_ai_plan_checkout('checkout-owner','aip_afterexpiry','cks_late','https://checkout.test/late',$1) r`, [203 * DAY])).r, "subscribed");
}
for (const role of ["anon","authenticated"]) {
  assert.equal((await one(`select has_function_privilege($1,'public.claim_ai_plan_checkout(text,text,text,text,bigint)','execute') allowed`, [role])).allowed, false);
  assert.equal((await one(`select has_table_privilege($1,'public.ai_plan_checkouts','select') allowed`, [role])).allowed, false);
}
console.log("subscription checkouts: one durable account claim, shared pending/session state, expiry and private RPCs");

console.log("AI plans SQL: all checks passed");
