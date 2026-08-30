/**
 * Do the stored procedures name columns that exist?
 *
 * This test exists because of one bug. `20260826130000_withdrawal_lifecycle.sql` added
 * `payment_evidence`; `20260826140000_atomic_withdrawals.sql`, written next, inserted into
 * and updated `evidence`. PL/pgSQL does not resolve column names until the function body
 * runs, so both migrations applied cleanly, every test stayed green, and the whole payout
 * path threw the first time somebody asked to be paid:
 *
 *   ERROR:  42703: column "evidence" of relation "withdrawals" does not exist
 *
 * Nothing could have caught it. Every payout test runs against `memoryStore.ts`, so the one
 * implementation that is actually deployed was the one implementation with no coverage, and
 * the SQL only fails at runtime against a real database. This reads the migrations as text
 * instead: it replays them to work out what columns each table ends up with, then checks
 * every `insert` and `update` in the *final* definition of each function against that.
 *
 * Deliberately the final definition, not every historical one. A migration that is later
 * replaced is history, and history is allowed to have been wrong - what has to be true is
 * what runs now.
 *
 * It is a text scan, not a parser, and it is not trying to be one. It catches a column name
 * that does not exist anywhere on the table, which is the whole class of bug that produced
 * F-01. Anything subtler is a job for a real database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
}

/** Line comments only; the repo's SQL has no block comments and none of these bodies do. */
const strip = (sql: string): string => sql.replace(/--[^\n]*/g, "");

const NOT_A_COLUMN = new Set([
  "primary",
  "unique",
  "check",
  "foreign",
  "constraint",
  "exclude",
  "like",
]);

/** Every column each table ends up with, after all migrations have run. */
function finalColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const columnsOf = (table: string): Set<string> => {
    const found = tables.get(table) ?? new Set<string>();
    tables.set(table, found);
    return found;
  };

  for (const { sql } of migrations()) {
    const clean = strip(sql);

    // create table [if not exists] public.<name> ( ... );
    const created = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/g;
    for (const [, table, body] of clean.matchAll(created)) {
      const columns = columnsOf(table as string);
      let depth = 0;
      let current = "";
      const parts: string[] = [];
      for (const char of body as string) {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        if (char === "," && depth === 0) {
          parts.push(current);
          current = "";
        } else current += char;
      }
      parts.push(current);
      for (const part of parts) {
        const name = part.trim().split(/\s+/)[0]?.toLowerCase();
        if (name !== undefined && /^\w+$/.test(name) && !NOT_A_COLUMN.has(name)) columns.add(name);
      }
    }

    // alter table public.<name> ... add column [if not exists] <col> <type>
    const altered = /alter\s+table\s+public\.(\w+)([\s\S]*?);/g;
    for (const [, table, body] of clean.matchAll(altered)) {
      const columns = columnsOf(table as string);
      const adds = /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/g;
      for (const [, column] of (body as string).matchAll(adds)) columns.add(column as string);
    }
  }
  return tables;
}

/** The last definition of each function, which is the one that runs. */
function finalFunctions(): Map<string, { migration: string; body: string }> {
  const found = new Map<string, { migration: string; body: string }>();
  for (const { name, sql } of migrations()) {
    const defined = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\([\s\S]*?\n\$\$;/g;
    for (const match of strip(sql).matchAll(defined)) {
      found.set(match[1] as string, { migration: name, body: match[0] });
    }
  }
  return found;
}

/** Column names written by the inserts and updates in one chunk of SQL. */
function columnsWritten(sql: string): { table: string; column: string }[] {
  const written: { table: string; column: string }[] = [];

  const inserts = /insert\s+into\s+public\.(\w+)\s*\(([^)]*)\)\s*values/gi;
  for (const [, table, list] of sql.matchAll(inserts)) {
    for (const raw of (list as string).split(",")) {
      const column = raw.trim().toLowerCase();
      if (/^\w+$/.test(column)) written.push({ table: table as string, column });
    }
  }

  // `update public.x set a=1, b=2 where ...` - and never `on conflict do update set`,
  // whose assignments are checked by the insert above it.
  const updates = /(?<!do\s)update\s+public\.(\w+)\s+set\s([\s\S]*?)(?:\bwhere\b|;)/gi;
  for (const [, table, assignments] of sql.matchAll(updates)) {
    for (const raw of (assignments as string).split(",")) {
      const column = raw.trim().split("=")[0]?.trim().toLowerCase();
      if (column !== undefined && /^\w+$/.test(column)) {
        written.push({ table: table as string, column });
      }
    }
  }
  return written;
}

describe("migrations", () => {
  const tables = finalColumns();

  it("knows the tables the payment and payout paths write to", () => {
    // A guard on the scanner itself: if the parsing above silently stopped working, every
    // other assertion here would pass by finding nothing to check.
    for (const table of [
      "withdrawals",
      "payout_profiles",
      "payout_corridors",
      "ledger_entries",
      "balances",
      "advertisers",
      "advertiser_credit_orders",
      "advertiser_credit_entries",
      "provider_events",
    ]) {
      expect(tables.get(table)?.size ?? 0).toBeGreaterThan(3);
    }
    expect(tables.get("withdrawals")).toContain("payment_evidence");
    expect(tables.get("withdrawals")).toContain("destination_key_id");
    expect(tables.get("withdrawals")).not.toContain("evidence");
  });

  it("every column a live function writes exists on its table", () => {
    const wrong: string[] = [];
    for (const [name, { migration, body }] of finalFunctions()) {
      for (const { table, column } of columnsWritten(body)) {
        const known = tables.get(table);
        if (known === undefined) continue; // not a table this repo creates
        if (!known.has(column)) wrong.push(`${migration}: ${name}() writes ${table}.${column}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every column a top-level statement writes exists on its table", () => {
    const wrong: string[] = [];
    for (const { name, sql } of migrations()) {
      const withoutFunctions = strip(sql).replace(
        /create\s+or\s+replace\s+function[\s\S]*?\n\$\$;/g,
        "",
      );
      for (const { table, column } of columnsWritten(withoutFunctions)) {
        const known = tables.get(table);
        if (known === undefined) continue;
        if (!known.has(column)) wrong.push(`${name}: writes ${table}.${column}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
