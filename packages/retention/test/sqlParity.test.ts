/**
 * The rules run twice: in TypeScript (`src/rules.ts`, the specification) and in SQL (the
 * hourly rollup in `supabase/migrations/20261120120000_retention_tracking.sql`, what
 * production serves). This replays the same population through the migration in PGlite -
 * in two halves and in small batches, so the incremental merge is exercised too - and
 * fails if any account's facts or reason, or any summary, differ.
 *
 * PGlite is not a declared dependency (the SQL check scripts in scripts/ use a copy installed by
 * hand), so it is loaded at run time and the suite is skipped where it is missing - CI included.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SILENT_DAY_CHOICES, churnReason, foldEvents, furthestStep, isChurned, summarize, type UserFacts } from "@adcode/retention";
import { DAY, NOW, POPULATION } from "./fixture.ts";

const MIGRATION = fileURLToPath(new URL("../../../supabase/migrations/20261120120000_retention_tracking.sql", import.meta.url));

// Loaded by name so the type checker does not need the package either.
const PGLITE_MODULE = "@electric-sql/pglite";
type PGliteLike = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; exec(sql: string): Promise<unknown>; close(): Promise<void> };
const pglite = await import(/* @vite-ignore */ PGLITE_MODULE).catch(() => null) as { PGlite: new () => PGliteLike } | null;
const hasPglite = pglite !== null;

let db: PGliteLike;
const facts = new Map<string, UserFacts>(POPULATION.map((person) => [person.uid, foldEvents(person.uid, person.events)!]));

async function json<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ data: T }>(sql, params);
  return result.rows[0]!.data;
}

beforeAll(async () => {
  if (pglite === null) return;
  db = new pglite.PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as 'insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid';
    create function cron.unschedule(id bigint) returns boolean language sql as 'delete from cron.job where jobid = id returning true';
  `);
  await db.exec(readFileSync(MIGRATION, "utf8"));
  const received = NOW - 3_600_000;
  const record = (uid: string, items: unknown[]): Promise<unknown> =>
    db.query("select public.record_retention_events($1, $2, $3::jsonb)", [uid, received, JSON.stringify(items)]);
  // First half of everyone's events, rolled up in batches of seven; then the rest.
  for (const person of POPULATION) await record(person.uid, person.events.slice(0, Math.ceil(person.events.length / 2)));
  while ((await db.query<{ n: number }>("select public.retention_rollup($1, 7) as n", [NOW])).rows[0]!.n > 0) { /* fold */ }
  for (const person of POPULATION) await record(person.uid, person.events.slice(Math.ceil(person.events.length / 2)));
  await db.query("select public.refresh_retention($1)", [NOW]);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe.skipIf(!hasPglite)("the SQL rollup agrees with the rules", () => {
  it("folds every account to the same facts", async () => {
    const rows = (await db.query<Record<string, unknown>>("select * from public.retention_users order by uid")).rows;
    expect(rows).toHaveLength(POPULATION.length);
    for (const row of rows) {
      const expected = facts.get(row["uid"] as string)!;
      expect({
        first: row["first"], last: row["last"], counts: row["counts"],
        firstSeenAt: Number(row["first_seen_at"]), lastSeenAt: Number(row["last_seen_at"]), activeDays: row["active_days"],
        lastError: row["last_error_at"] === null ? null : { name: row["last_error_name"], code: row["last_error_code"], at: Number(row["last_error_at"]) },
        lastSession: row["last_session_at"] === null ? null : { code: row["last_session_code"], ms: row["last_session_ms"], at: Number(row["last_session_at"]) },
        version: row["version"],
      }, row["uid"] as string).toEqual({
        first: expected.first, last: expected.last, counts: expected.counts,
        firstSeenAt: expected.firstSeenAt, lastSeenAt: expected.lastSeenAt, activeDays: expected.activeDays,
        lastError: expected.lastError, lastSession: expected.lastSession, version: expected.version,
      });
    }
  });

  it("gives every account the same likely reason and furthest step", async () => {
    const rows = (await db.query<{ uid: string; churn_reason: string; step: string | null }>(
      "select uid, churn_reason, public.retention_furthest_step(first) as step from public.retention_users",
    )).rows;
    for (const row of rows) {
      const person = facts.get(row.uid)!;
      expect(row.churn_reason, row.uid).toBe(churnReason(person));
      expect(row.churn_reason, row.uid).toBe(POPULATION.find((candidate) => candidate.uid === row.uid)!.expected);
      expect(row.step, row.uid).toBe(furthestStep(person));
    }
  });

  for (const silent of SILENT_DAY_CHOICES) {
    it(`builds the same summary for ${silent} silent days`, async () => {
      const cached = await json<Record<string, unknown>>("select public.read_retention_summary($1) as data", [silent]);
      const { builtAt, ...report } = cached;
      expect(builtAt).toBe(NOW);
      expect(report).toEqual(JSON.parse(JSON.stringify(summarize([...facts.values()], NOW, silent))));
    });
  }

  it("lists the same churned accounts, most recently lost first, filterable by reason", async () => {
    const listed = await json<{ total: number; users: { uid: string; reason: string; furthestStep: string | null }[] }>(
      "select public.read_retention_churned($1, 7, null, 0, 50) as data", [NOW],
    );
    const expected = [...facts.values()].filter((person) => isChurned(person, NOW, 7)).sort((a, b) => b.lastSeenAt - a.lastSeenAt || (a.uid < b.uid ? -1 : 1));
    expect(listed.total).toBe(expected.length);
    expect(listed.users.map((user) => user.uid)).toEqual(expected.map((person) => person.uid));
    const crashed = await json<{ total: number; users: { uid: string }[] }>("select public.read_retention_churned($1, 7, 'crashed', 0, 50) as data", [NOW]);
    expect(crashed.users.map((user) => user.uid).sort()).toEqual(["u-crashed", "u-renderer"]);
    const page = await json<{ total: number; users: unknown[] }>("select public.read_retention_churned($1, 7, null, 2, 3) as data", [NOW]);
    expect(page.total).toBe(expected.length);
    expect(page.users).toHaveLength(3);
  });

  it("serves one account's timeline, newest first", async () => {
    const timeline = await json<{ user: { uid: string; reason: string }; daily: unknown[]; events: { name: string; at: number }[] }>(
      "select public.read_retention_user('u-limit') as data",
    );
    expect(timeline.user).toMatchObject({ uid: "u-limit", reason: "hit_limit", furthestStep: "preview_opened", newInstall: true });
    expect(timeline.events[0]).toMatchObject({ name: "session_end", at: NOW - 10 * DAY });
    expect(timeline.events).toHaveLength(POPULATION.find((person) => person.uid === "u-limit")!.events.length);
    expect(timeline.daily).toHaveLength(2);
  });
});

describe.skipIf(!hasPglite)("the tables keep their promises", () => {
  it("deletes raw events after 90 days and keeps the per-account rows", async () => {
    await db.query("select public.refresh_retention($1)", [NOW + 91 * DAY]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.retention_events")).rows[0]!.n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.retention_users")).rows[0]!.n).toBe(POPULATION.length);
  });

  it("refuses free text in a code", async () => {
    await expect(db.query("select public.record_retention_events('u', 1, $1::jsonb)", [JSON.stringify([{ name: "turn_failed", at: 1, code: "C:\\Users\\me" }])]))
      .rejects.toThrow(/check constraint/);
  });

  it("is closed to the browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select public.read_retention_summary(7)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.retention_events")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await expect(db.query("select public.read_retention_summary(7)")).resolves.toBeDefined();
    await db.exec("reset role");
  });

  it("schedules the hourly rollup", async () => {
    const jobs = (await db.query<{ jobname: string; schedule: string; command: string }>("select jobname, schedule, command from cron.job")).rows;
    expect(jobs).toEqual([{ jobname: "retention-rollup", schedule: "17 * * * *", command: expect.stringContaining("refresh_retention()") }]);
  });
});
