import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema cron; create table cron.jobs_seen(name text,schedule text,command text);
    create function cron.schedule(a text,b text,c text) returns bigint language sql as 'insert into cron.jobs_seen values(a,b,c) returning 1::bigint';`);
  for (const name of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync("supabase/migrations/"+name,"utf8").replace(/create extension if not exists pg_cron[^;]*;/gi,""));
  }
  const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
  await db.exec(`insert into public.users(uid,status,created_at) values('network-user','active',1);
    insert into public.ad_network_settings values('network','{"id":"network"}', 'admin',1);
    insert into public.ad_network_deliveries values('delivery','network','network-user','an_delivery','provider-ad',1000,5000,1200,5000,'https://sponsor.com/logo.png','https://sponsor.com/logo.png');
    insert into public.ad_network_deliveries values('delivery2','network','network-user','an_delivery2','provider-ad2',1000,5000,1200,5000,'https://sponsor.com/logo.png','https://sponsor.com/logo.png');`);
  const call = async (id,event,provider) => (await one("select public.settle_ad_network_event($1,$2,$3,3000) as ok",[id,event,provider])).ok;
  assert.equal(await call("missing","impression","p0"),false);
  assert.equal(await call("delivery","dismissed","p0"),false);
  assert.equal(await call("delivery","impression","pv1"),true);
  assert.equal(await call("delivery","impression","another-id"),false);
  assert.equal(await call("delivery2","impression","pv1"),false);
  assert.equal((await one("select available_micros::text as amount from balances where uid='network-user'")).amount,"1200");
  assert.equal(await call("delivery","click","pc1"),true);
  assert.equal(await call("delivery","click","pc1"),false);
  assert.equal((await one("select available_micros::text as amount from balances where uid='network-user'")).amount,"6200");
  assert.equal((await one("select count(*) as n from ledger_entries where uid='network-user'")).n,2);
  assert.equal((await one("select count(*) as n from ad_network_events")).n,2);
  assert.equal((await one("select count(*) as n from campaign_spend")).n,0);
  const race = await Promise.all([call("delivery2","impression","pv2"),call("delivery2","impression","pv2-race")]);
  assert.equal(race.filter(Boolean).length,1);
  for(const role of ["anon","authenticated"]){
    await db.exec(`set role ${role}`);
    for(const table of ["ad_network_settings","ad_network_credentials","ad_network_deliveries","ad_network_events"]) await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
    await assert.rejects(db.query("select public.settle_ad_network_event('delivery','click','forged',3000)"),/permission denied/);
    await db.exec("reset role");
  }
  console.log("Ad network SQL passed: private credentials, owned delivery snapshots, event and provider deduplication, atomic ledger/balance, no campaign charges, concurrent retries and unprivileged access denied.");
} finally { await db.close(); }
