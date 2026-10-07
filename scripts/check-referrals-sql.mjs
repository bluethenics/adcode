// Holds the referral SQL to the TypeScript rules, in a real Postgres.
//
// Replays every migration into PGlite (Postgres compiled to WebAssembly), seeds one referral
// world, and checks that `settle_referrals`, `referral_summary`, `referral_source_facts` and
// `referrals_for_user` produce exactly what `services/api/src/referrals.ts` (and the growth
// sightings in `growth.ts`) compute for the same rows - and that a day settled twice pays once.
// No test in `npm run verify` can execute SQL; run this after any change to either side.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/check-referrals-sql.mjs .
//
// It caught `sum(bigint)` being numeric in Postgres, which rounded a 1699.9 share up to 1700
// where the TypeScript floors to 1699.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const ROOT = process.argv[2];
const MIG = join(ROOT, "supabase/migrations");
const R = await import(pathToFileURL(join(ROOT, "services/api/src/referrals.ts")).href);
const G = await import(pathToFileURL(join(ROOT, "services/api/src/growth.ts")).href);

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
  try {
    await db.exec(sql);
  } catch (error) {
    console.error(`MIGRATION FAILED: ${name}: ${error.message}`);
    process.exit(1);
  }
}
console.log("migrations: all applied");

const DAY_MS = 86_400_000;
const DAY = "2026-10-06";
const START = Date.parse(`${DAY}T00:00:00.000Z`);
const NOON = START + DAY_MS / 2;
const NOW = START + DAY_MS + 1800_000;

// ── The world ────────────────────────────────────────────────────────────────
const users = [
  ["sam", "active"], ["kim", "active"], ["viewer", "active"], ["stranger", "active"], ["oldie", "active"],
  ["badref", "banned"], ["viewer2", "active"], ["lurker", "active"], ["organic", "active"], ["banned-viewer", "banned"],
].map(([uid, status], i) => ({ uid, status, createdAt: START - (20 - i) * DAY_MS }));
const campaigns = [["camp-x", "adv-x"], ["camp-o", "adv-o"], ["camp-house", "adv-house"], ["camp-bad", "adv-bad"]];
const codes = [["samcode1", "sam"], ["kimcode1", "kim"], ["badcode1", "badref"], ["threads-oct06", null]];
const A = (subjectKind, subjectId, code, referrerUid, claimedAt) => ({ subjectKind, subjectId, code, referrerUid, how: "paste", claimedAt });
const attributions = [
  A("user", "viewer", "samcode1", "sam", START - DAY_MS),
  A("advertiser", "adv-x", "kimcode1", "kim", START - 2 * DAY_MS),
  A("advertiser", "adv-bad", "kimcode1", "kim", START - 2 * DAY_MS),
  A("user", "viewer2", "badcode1", "badref", START - DAY_MS),
  A("user", "lurker", "threads-oct06", null, START - 3 * DAY_MS),
  A("user", "oldie", "samcode1", "sam", NOON - 365 * DAY_MS),
  A("user", "banned-viewer", "samcode1", "sam", START - DAY_MS),
];
let seq = 0;
const Rc = (uid, campaignId, cost, at = NOON) => ({ receiptId: `r${++seq}`, uid, creativeId: "cr", campaignId, outcome: "impression", creditedMicros: cost / 2n, costMicros: cost, createdAt: at });
const receipts = [
  Rc("viewer", "camp-o", 8000n),
  Rc("stranger", "camp-x", 8000n),
  Rc("viewer", "camp-x", 8000n),
  Rc("viewer", "camp-house", 2000n),
  Rc("viewer", "camp-o", 0n),
  Rc("stranger", "camp-bad", 8000n),
  Rc("viewer2", "camp-o", 8000n),
  Rc("viewer", "camp-o", 333n), Rc("viewer", "camp-o", 333n), Rc("viewer", "camp-o", 333n),
  Rc("viewer", "camp-o", 8000n, START + DAY_MS + 5),
  Rc("oldie", "camp-o", 8000n, NOON - 1),
  Rc("oldie", "camp-o", 8000n, NOON),
  Rc("banned-viewer", "camp-o", 8000n),
  Rc("organic", "camp-x", 4000n, START - 3 * DAY_MS),
  Rc("viewer", "camp-o", 9n, START - 2 * DAY_MS),
];
const serves = [["viewer", START + 1000, false], ["viewer", START - 3 * DAY_MS, true], ["organic", START - 3 * DAY_MS, false]];
const milestones = [["viewer", "welcome_shown", START - DAY_MS, START - DAY_MS], ["lurker", "turn_ok", START - 4 * DAY_MS, START - 2 * DAY_MS]];
const activity = [["viewer2", "2026-10-01"], ["viewer2", "2026-10-02"]];
const milestoneDays = [["lurker", "2026-10-05", START - DAY_MS + 5, START - DAY_MS + 9], ["organic", "2026-10-05", START - DAY_MS + 1, START - DAY_MS + 1]];
const config = { userPercent: 10n, advertiserPercent: 5n, windowDays: 365, claimDays: 14, houseAdvertiserIds: ["adv-house"] };

for (const u of users) await db.query("insert into public.users (uid, status, created_at) values ($1, $2, $3)", [u.uid, u.status, u.createdAt]);
for (const [campaignId, advertiserId] of campaigns) {
  await db.query("insert into public.advertisers (advertiser_id, name, owner_uids, created_at) values ($1, $1, '{boss}', 1) on conflict do nothing", [advertiserId]);
  await db.query("insert into public.campaigns (campaign_id, advertiser_id, name, created_at, cpm_micros, budget_micros) values ($1, $2, $1, 1, 8000000, 1000000000)", [campaignId, advertiserId]);
}
await db.query(`insert into public.advertiser_credit_orders (order_id, advertiser_id, amount_micros, billing_country, customer_email, status, created_at, updated_at)
  values ('o1', 'adv-bad', 10000000, 'GB', 'a@b.c', 'disputed', 1, 1)`);
await db.query("update public.referral_config set house_advertiser_ids = '{adv-house}' where id = 1");
for (const [code, owner] of codes) await db.query("insert into public.ref_codes (code, owner_uid, created_at) values ($1, $2, 1)", [code, owner]);
for (const a of attributions) {
  await db.query("insert into public.attributions (subject_kind, subject_id, code, referrer_uid, how, claimed_at) values ($1, $2, $3, $4, $5, $6)",
    [a.subjectKind, a.subjectId, a.code, a.referrerUid, a.how, a.claimedAt]);
}
for (const r of receipts) {
  await db.query("insert into public.receipts (receipt_id, uid, creative_id, campaign_id, outcome, credited_micros, cost_micros, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [r.receiptId, r.uid, r.creativeId, r.campaignId, r.outcome, String(r.creditedMicros), String(r.costMicros), r.createdAt]);
}
let s = 0;
for (const [uid, at, test] of serves) await db.query("insert into public.serves (serve_id, uid, creative_id, campaign_id, served_at, expires_at, test) values ($1, $2, 'cr', 'camp-o', $3, $3, $4)", [`s${++s}`, uid, at, test]);
for (const [uid, name, first, last] of milestones) await db.query("insert into public.milestones (uid, name, first_at, last_at) values ($1, $2, $3, $4)", [uid, name, first, last]);
for (const [uid, day] of activity) await db.query("insert into public.activity_daily (uid, day, updated_at) values ($1, $2, 1)", [uid, day]);
for (const [uid, day, first, last] of milestoneDays) await db.query("insert into public.milestone_days (uid, day, first_at, last_at) values ($1, $2, $3, $4)", [uid, day, first, last]);

const text = (v) => (typeof v === "bigint" ? v.toString() : v);
const rows = async (sql, params) => (await db.query(sql, params)).rows;
let checks = 0;
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks += 1; console.log(`ok  ${name}`); };

// ── Settlement ───────────────────────────────────────────────────────────────
const expectedShares = R.planReferralShares({
  day: DAY, config, receipts,
  campaignAdvertiser: new Map(campaigns),
  attributions,
  userStatus: new Map(users.map((u) => [u.uid, u.status])),
  badAdvertisers: new Set(["adv-bad"]),
});
const expectedEntries = R.entriesForShares(DAY, NOW, expectedShares);
assert.ok(expectedShares.length >= 3, "fixture produces shares");

const [{ result: first }] = await rows("select public.settle_referrals($1, $2) as result", [DAY, NOW]);
check("settle returns referrers and micros", first, {
  referrers: expectedEntries.length,
  micros: expectedEntries.reduce((sum, e) => sum + e.micros, 0n).toString(),
});

const shareRows = await rows("select day, referrer_uid, subject_kind, subject_id, base_micros::text as base, share_micros::text as share from public.referral_shares order by referrer_uid, subject_kind, subject_id");
check("share rows match the TypeScript rules", shareRows.map((r) => [r.day, r.referrer_uid, r.subject_kind, r.subject_id, r.base, r.share]),
  expectedShares.map((x) => [x.day, x.referrerUid, x.subjectKind, x.subjectId, text(x.baseMicros), text(x.shareMicros)]));

const entryRows = await rows("select entry_id, uid, kind, micros::text as micros, ref_id, created_at::text as created_at, description from public.ledger_entries where kind = 'referral' order by uid");
check("ledger entries match", entryRows.map((e) => [e.entry_id, e.uid, e.kind, e.micros, e.ref_id, e.created_at, e.description]),
  expectedEntries.map((e) => [e.entryId, e.uid, e.kind, text(e.micros), e.refId, String(e.createdAt), e.description]));

const balanceOf = async (uid) => (await rows("select available_micros::text as a, lifetime_micros::text as l, pending_withdrawal_micros::text as p from public.balances where uid = $1", [uid]))[0];
for (const e of expectedEntries) check(`balance of ${e.uid}`, await balanceOf(e.uid), { a: text(e.micros), l: text(e.micros), p: "0" });

const [{ result: again }] = await rows("select public.settle_referrals($1, $2) as result", [DAY, NOW + 99]);
check("a second settlement pays nobody", again, { referrers: 0, micros: "0" });
check("and writes no new share rows", (await rows("select count(*)::int as n from public.referral_shares"))[0].n, expectedShares.length);
for (const e of expectedEntries) check(`balance of ${e.uid} unchanged`, await balanceOf(e.uid), { a: text(e.micros), l: text(e.micros), p: "0" });

const [{ result: recent }] = await rows("select public.settle_referrals_recent($1) as result", [START + 2 * DAY_MS + 60_000]);
const nextDay = R.planReferralShares({ day: "2026-10-07", config, receipts, campaignAdvertiser: new Map(campaigns), attributions, userStatus: new Map(users.map((u) => [u.uid, u.status])), badAdvertisers: new Set(["adv-bad"]) });
const nextEntries = R.entriesForShares("2026-10-07", 0, nextDay);
check("the nightly job settles the days it has not, and only those", recent, {
  referrers: nextEntries.length,
  micros: nextEntries.reduce((sum, e) => sum + e.micros, 0n).toString(),
});
check("cron job registered", (await rows("select name, schedule from cron.jobs_seen where name = 'settle-referrals'")).length, 1);

// ── Summary ──────────────────────────────────────────────────────────────────
// The real definition, from growth.ts: what Sources counts as seen must be what the growth panel does.
const sightingsList = G.sightings({
  serves: serves.map(([uid, at, test]) => ({ uid, servedAt: at, test })),
  activity: activity.map(([uid, day]) => ({ uid, day })),
  milestones: milestones.map(([uid, name, firstAt, lastAt]) => ({ uid, name, firstAt, lastAt })),
  milestoneDays: milestoneDays.map(([uid, day, firstAt, lastAt]) => ({ uid, day, firstAt, lastAt })),
});
const ledger = (await rows("select entry_id, uid, kind, micros::text as micros, created_at::text as created_at from public.ledger_entries"))
  .map((e) => ({ entryId: e.entry_id, uid: e.uid, kind: e.kind, micros: BigInt(e.micros), refId: null, createdAt: Number(e.created_at), description: "" }));
for (const uid of ["sam", "kim", "badref", "nobody"]) {
  const want = R.summarizeReferrer({ uid, now: NOW, attributions, sightings: sightingsList, entries: ledger.filter((e) => e.uid === uid) });
  const [{ result }] = await rows("select public.referral_summary($1, $2) as result", [uid, NOW]);
  check(`summary for ${uid}`, result, { ...want, earnedMicros: text(want.earnedMicros), last30Micros: text(want.last30Micros) });
}

// ── Sources facts ────────────────────────────────────────────────────────────
const shares = (await rows("select day, referrer_uid, subject_kind, subject_id, base_micros::text as b, share_micros::text as s from public.referral_shares"))
  .map((r) => ({ day: r.day, referrerUid: r.referrer_uid, subjectKind: r.subject_kind, subjectId: r.subject_id, baseMicros: BigInt(r.b), shareMicros: BigInt(r.s) }));
for (const since of [0, START - 5 * DAY_MS, START]) {
  const want = R.sourceFactsFrom({ since, users, attributions, sightings: sightingsList, receipts, campaignAdvertiser: new Map(campaigns), houseAdvertiserIds: ["adv-house"], shares });
  const got = await rows("select * from public.referral_source_facts($1)", [since]);
  const norm = (f) => [f.code, f.subjectKind, f.subjectId, f.referrerUid, String(f.at), f.seen, f.cameBack, text(f.grossMicros), text(f.creditedMicros), text(f.paidMicros)];
  const sortKey = (a) => `${a[1]} ${a[2]}`;
  check(`facts since ${since}`,
    got.map((r) => [r.code, r.subject_kind, r.subject_id, r.referrer_uid, String(r.at), r.seen, r.came_back, r.gross_micros, r.credited_micros, r.paid_micros]).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    want.map(norm).sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
}

// ── People ───────────────────────────────────────────────────────────────────
const [{ result: forViewer }] = await rows("select public.referrals_for_user('viewer') as result");
check("invited by", forViewer, { invitedBy: { subjectKind: "user", subjectId: "viewer", code: "samcode1", referrerUid: "sam", how: "paste", claimedAt: START - DAY_MS }, invited: [] });
const [{ result: forKim }] = await rows("select public.referrals_for_user('kim') as result");
check("invited, newest first", forKim.invited.map((a) => a.subjectId), ["adv-bad", "adv-x"].sort());

// ── Guards ───────────────────────────────────────────────────────────────────
await assert.rejects(db.query("insert into public.ref_codes (code, owner_uid, created_at) values ('another1', 'sam', 1)"), /duplicate key/);
checks += 1; console.log("ok  one code per owner");
await assert.rejects(db.query("insert into public.ref_codes (code, created_at) values ('Bad Code', 1)"), /check constraint/);
checks += 1; console.log("ok  code shape enforced");
await assert.rejects(db.query("insert into public.attributions (subject_kind, subject_id, code, how, claimed_at) values ('user', 'viewer', 'samcode1', 'paste', 1)"), /duplicate key/);
checks += 1; console.log("ok  first claim wins");
await db.query("insert into public.ledger_entries (entry_id, uid, kind, micros, created_at, description) values ('c1', 'sam', 'contribution', 1000000, 1, 'thanks')");
checks += 1; console.log("ok  contribution kind accepted");
const grants = await rows(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('service_role', p.oid, 'execute') as svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('settle_referrals','settle_referrals_recent','referral_summary','referral_source_facts','referrals_for_user','referral_seen_days')`);
check("every referral function: no anon, yes service_role", grants.map((g) => [g.proname, g.anon, g.svc]).sort(), grants.map((g) => [g.proname, false, true]).sort());
check("all six functions exist", grants.length, 6);

console.log(`\nALL ${checks} CHECKS PASSED`);
