// Runs convert_earnings_to_credits in a real Postgres (PGlite) and checks the money moves.
//
// The route tests run on memoryStore.ts; this is the one check of the SQL that is actually
// deployed. It proves: one call moves earnings and credits together and writes the audit
// row; a replay of the same request id moves nothing; the same id with another amount is a
// conflict; not enough balance and the daily cap refuse without moving anything; and the
// earnings ledger accepts the new 'credit_conversion' kind.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/check-earnings-conversion-sql.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.users(uid text primary key);
  insert into public.users values ('u'), ('v');
  create table public.ledger_entries (
    entry_id text primary key, uid text not null, kind text not null, micros bigint not null,
    ref_id text, created_at bigint not null, description text not null, reason text,
    admin_uid text, provider_ref text, currency text,
    constraint ledger_entries_kind_check check (kind in ('impression'))
  );
  create table public.balances (
    uid text primary key, available_micros bigint not null default 0,
    lifetime_micros bigint not null default 0, pending_withdrawal_micros bigint not null default 0
  );
  insert into public.balances values ('u', 5000000, 7000000, 0);
`);
await db.exec(readFileSync("supabase/migrations/20261029175011_prepaid_model_wallet.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/20261119120000_earnings_to_credits.sql", "utf8"));

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const R1 = "00000000-0000-4000-8000-000000000001";
const R2 = "00000000-0000-4000-8000-000000000002";
const R3 = "00000000-0000-4000-8000-000000000003";
const DAY = 86_400_000;
const convert = async (uid, request, earnings, { cap = 1_000_000_000, dayStart = 0, now = 1000 } = {}) =>
  (await one(`select public.convert_earnings_to_credits($1,$2,$3,$4,$5,$6,$7,$8,'Converted to AI credits') r`,
    [uid, request, earnings, earnings, cap, dayStart, now, `conv-${uid}-${request}`])).r;
const earnings = async (uid) => (await one(`select available_micros a, lifetime_micros l from public.balances where uid=$1`, [uid]));
const credit = async (uid) => Number((await one(`select balance_micros b from public.model_wallet_balances where uid=$1`, [uid]))?.b ?? 0);
const count = async (table) => Number((await one(`select count(*) n from public.${table}`)).n);

// 1. One call moves both balances and writes every row.
let r = await convert("u", R1, 2_000_000);
assert.equal(r.status, "converted");
assert.equal(r.availableMicros, "3000000");
assert.equal(r.creditBalanceMicros, "2000000");
assert.equal(Number((await earnings("u")).a), 3_000_000);
assert.equal(Number((await earnings("u")).l), 7_000_000, "lifetime earnings keep converted money");
assert.equal(await credit("u"), 2_000_000);
assert.equal(await count("ledger_entries"), 1);
assert.equal(await count("model_wallet_ledger"), 1);
const audit = await one(`select * from public.earnings_conversions where uid='u'`);
assert.equal(Number(audit.available_before_micros), 5_000_000);
assert.equal(Number(audit.available_after_micros), 3_000_000);
assert.equal(Number(audit.credit_balance_before_micros), 0);
assert.equal(Number(audit.credit_balance_after_micros), 2_000_000);
const entry = await one(`select kind, micros from public.ledger_entries`);
assert.equal(entry.kind, "credit_conversion");
assert.equal(Number(entry.micros), -2_000_000);
const view = (await one(`select public.model_wallet_view('u', 1000) v`)).v;
assert.equal(view.activity[0].kind, "earnings", "the credit wallet's history names where the money came from");

// 2. A replay (double click, retry after a lost response) moves nothing.
r = await convert("u", R1, 2_000_000);
assert.equal(r.status, "replayed");
assert.equal(r.creditBalanceMicros, "2000000");
assert.equal(Number((await earnings("u")).a), 3_000_000);
assert.equal(await credit("u"), 2_000_000);
assert.equal(await count("earnings_conversions"), 1);

// 3. The same id with another amount is refused, not guessed at.
assert.equal((await convert("u", R1, 1_000_000)).status, "conflict");
assert.equal(await credit("u"), 2_000_000);

// 4. Not enough earnings: refused, nothing moves.
r = await convert("u", R2, 3_500_000);
assert.equal(r.status, "insufficient-funds");
assert.equal(r.availableMicros, "3000000");
assert.equal(await count("earnings_conversions"), 1);
assert.equal(await credit("u"), 2_000_000);

// An account with no earnings row at all is "not enough", not an error.
assert.equal((await convert("v", R2, 1_000_000)).status, "insufficient-funds");

// 5. The daily cap counts today's conversions; tomorrow starts again.
r = await convert("u", R2, 1_000_000, { cap: 2_500_000 });
assert.equal(r.status, "daily-cap");
assert.equal(r.convertedTodayMicros, "2000000");
r = await convert("u", R2, 1_000_000, { cap: 2_500_000, dayStart: DAY, now: DAY + 1 });
assert.equal(r.status, "converted", "yesterday's conversions do not count against today");
assert.equal(await credit("u"), 3_000_000);

// 6. Out-of-range amounts never reach the balances.
await assert.rejects(convert("u", R3, 0), /out of range/);
await assert.rejects(convert("u", R3, 1_000_000_001), /out of range/);

// 7. Browser roles cannot call it or read the audit table.
const grants = await one(`select has_function_privilege('anon', 'public.convert_earnings_to_credits(text,uuid,bigint,bigint,bigint,bigint,bigint,text,text)', 'execute') a,
  has_function_privilege('authenticated', 'public.convert_earnings_to_credits(text,uuid,bigint,bigint,bigint,bigint,bigint,text,text)', 'execute') b,
  has_table_privilege('authenticated', 'public.earnings_conversions', 'select') c,
  has_table_privilege('service_role', 'public.earnings_conversions', 'update') d`);
assert.deepEqual([grants.a, grants.b, grants.c, grants.d], [false, false, false, false]);

console.log("earnings conversion SQL: all checks passed");
