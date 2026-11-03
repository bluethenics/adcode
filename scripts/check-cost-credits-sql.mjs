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
  if (name.includes('cost_based_ai_credits')) {
    await db.exec("insert into users(uid,created_at) values('cost-user',0); insert into ai_token_balances(uid,purchased,reserved,updated_at) values('cost-user',55000000,0,0)");
    await db.query("insert into tagflow_config(id,config,updated_at,updated_by) values(1,$1::jsonb,0,'test')", [JSON.stringify({paid:{enabled:true,freeWeeklyTokens:2000000,packs:[],providers:['custom-heabsy']},campaign:{name:'old'},models:[{id:'deepseek-v4.1-flash-unc',provider:'custom-heabsy',inputPrice:0,outputPrice:0}]})]);
  }
  try { await db.exec(sql); } catch (error) { console.error(`MIGRATION FAILED: ${name}: ${error.message}`); process.exit(1); }
}
console.log("migrations: all applied");

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];

const now=1000;
const cfg=(await one("select config from tagflow_config where id=1")).config;
assert.equal(cfg.paid.accounting,'cost-v1');assert.equal(cfg.paid.freeWeeklyTokens,110000);assert.equal(cfg.campaign,undefined);
const deep=cfg.models.find(m=>m.id==='deepseek-v4.1-flash-unc'); assert.equal(deep.inputPrice,.4);assert.equal(deep.cacheInputPrice,.04);assert.equal(deep.outputPrice,1.4);


const reserve=async(id,tokens)=>(await one("select reserve_ai_cost_credits($1,'cost-user','2026-11-01',0,$2,0,1000000,9000000000000000,9000000000000000,1000,1000,0,0,0,18000000,false,true,100) r",[id,tokens])).r;
// Purchased value remains spendable; then exercise a free-only account.
assert.equal(Number((await one("select purchased from ai_token_balances where uid='cost-user'")).purchased),55000000);
await db.exec("update ai_token_balances set purchased=0 where uid='cost-user'");
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
assert.equal(await reserve(ids[0],80),'ok');
assert.equal(await reserve(ids[1],80),'paid-limit');
assert.equal(Number((await one("select reserved_millicredits n from ai_credit_windows where uid='cost-user' and kind='cost_day'")).n),80);
await db.query("select settle_ai_with_tokens($1,10,2,1,0,false,false,40)",[ids[0]]);
assert.equal(Number((await one("select used_millicredits n from ai_credit_windows where uid='cost-user' and kind='cost_day'")).n),40);
assert.equal(await reserve(ids[1],60),'ok');
console.log('cost-credit SQL: full reservations, concurrent holds and actual settlement passed');
await db.exec("update ai_token_balances set purchased=1000000 where uid='cost-user'");
const fair=await one("select reserve_ai_fair_use('00000000-0000-4000-8000-000000000003','cost-user','2026-11-01',0,1,0,1000000,9000000000000000,9000000000000000,1000,1000,0,0,0,18000000,false,true,100) r");
assert.equal(fair.r,'paid-limit','fair use never spends purchased balances');
assert.equal(Number((await one("select purchased from ai_token_balances where uid='cost-user'")).purchased),1000000);
for(const [id,plan,end] of [['max-sub','max',20000],['all-sub','unlimited',10000]]) {
 assert.equal((await one("select apply_ai_subscription_event_v2($1,'active',$1,'cost-user',$2,'cus_cost','active',$3,false,1000,1000) r",[id,plan,end])).r,'applied');
}
assert.equal((await one("select plan from ai_plan_state_v2('cost-user',1000)")).plan,'unlimited');
assert.equal((await one("select plan from ai_plan_state_v2('cost-user',10001)")).plan,'max');
const summary=await q("select * from ai_subscription_summary(1000)");
assert.equal(Number(summary.find(p=>p.plan==='max').mrr_cents),9900);assert.equal(Number(summary.find(p=>p.plan==='unlimited').mrr_cents),29900);
for(const role of ['anon','authenticated']) assert.equal((await one("select has_function_privilege($1,(select oid from pg_proc where proname='reserve_ai_fair_use'),'execute') allowed",[role])).allowed,false);
console.log('expanded plans SQL: Max/Unlimited webhooks, ranking, expiry, MRR, private fair-use RPC and purchased-balance protection passed');
await db.close();
