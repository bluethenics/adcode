// Verify the allowance migration against saved settings and existing balances in Postgres.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create schema cron;
  create table cron.jobs_seen (name text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.jobs_seen values (a,b,c) returning 1::bigint $$;`);
for (const name of readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort()) {
  if (name === '20261029114851_shared_ai_allowance_increase.sql') {
    const limits = { dailyTokens: 2000000, dailyCostMicros: 1000000, dailyRequests: 1000000, requestsPerMinute: 1000 };
    const credits = { sessionCredits: 2000, weeklyCredits: 20000, sessionHours: 5 };
    const config = { limits, credits, paid: { enabled: true, providers: ['custom-heabsy'], freeWeeklyTokens: 10000000, packs: [{ id: '50m', tokens: 50000000, priceCents: 1000 }] }, providers: [{ id: 'custom-heabsy', limits }] };
    await db.query(`insert into public.tagflow_config values (1,$1,0,'test')`, [JSON.stringify(config)]);
    await db.query(`insert into public.tagflow_user_policies values ('u',$1)`, [JSON.stringify({ limits: { ...limits, dailyRequests: 50, requestsPerMinute: 10 }, credits })]);
    await db.query(`insert into public.tagflow_user_policies values ('blocked',$1)`, [JSON.stringify({ blocked: true, limits: { dailyTokens: 0, dailyCostMicros: 0, dailyRequests: 0, requestsPerMinute: 0 }, credits: null })]);
    await db.exec(`insert into public.ai_token_balances(uid,purchased,reserved) values ('u',100,20),('debt',-5,0);
      insert into public.ai_boosts(uid,weekly_tokens,starts_at,ends_at,created_by) values ('u',60000000,0,9000000000000,'test');`);
  }
  await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/create extension if not exists pg_cron[^;]*;/gi, ''));
}
const one = async sql => (await db.query(sql)).rows[0];
const { config } = await one(`select config from public.tagflow_config`);
assert.deepEqual(config.limits, { dailyTokens: 2200000, dailyCostMicros: 1100000, dailyRequests: 1000000, requestsPerMinute: 1000 });
assert.deepEqual(config.credits, { sessionCredits: 2200, weeklyCredits: 22000, sessionHours: 5 });
assert.equal(config.paid.freeWeeklyTokens, 5000000);
assert.deepEqual(config.paid.packs[0], { id: '50m', tokens: 55000000, priceCents: 1000 });
assert.equal(config.providers[0].limits.dailyTokens, 2200000);
const { policy } = await one(`select policy from public.tagflow_user_policies where uid='u'`);
assert.equal(policy.limits.dailyRequests, 55); assert.equal(policy.limits.requestsPerMinute, 11);
assert.equal((await one(`select policy from public.tagflow_user_policies where uid='blocked'`)).policy.limits.dailyTokens, 0);
assert.equal(Number((await one(`select purchased from public.ai_token_balances where uid='u'`)).purchased), 100);
assert.equal(Number((await one(`select purchased from public.ai_token_balances where uid='debt'`)).purchased), -5);
assert.equal(Number((await one(`select count(*) as total from public.ai_token_ledger where uid='u'`)).total), 0);
assert.equal(Number((await one(`select weekly_tokens from public.ai_boosts where uid='u'`)).weekly_tokens), 66000000);
assert.ok((await one(`select prosrc from pg_proc where proname='apply_ai_subscription_event_v2'`)).prosrc.includes(', 4400000,'));
// Verify the deployed reservation function's daily boundary, not just its source text.
const reserve = async (id, now) => (await db.query(`select public.reserve_ai_with_tokens($1::uuid,'daily','2026-10-30',1,5000000,0,1000000,1000000000,1000000000,1000,$2,0,0,0,18000000,false,true,5000000) result`, [id, now])).rows[0].result;
assert.equal(await reserve('00000000-0000-4000-8000-000000000001',1000),'ok');
const window = await one(`select * from public.ai_credit_windows where uid='daily' and kind='paid_week'`);
assert.equal(Number(window.ends_at)-Number(window.started_at),86400000);
await db.exec(`select public.settle_ai_with_tokens('00000000-0000-4000-8000-000000000001'::uuid,5000000,0,0,0,false,false,5000000)`);
assert.equal(await reserve('00000000-0000-4000-8000-000000000002',86400999),'paid-limit');
assert.equal(await reserve('00000000-0000-4000-8000-000000000003',86401000),'ok');
console.log('Daily allowance SQL: 5M defaults, exhaustion, 24-hour refill and preserved purchased balances passed.');
await db.close();
