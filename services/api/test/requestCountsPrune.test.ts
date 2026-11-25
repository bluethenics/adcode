/**
 * request_counts is the table behind every rate limit and card cap. It grew without bound
 * (1.33M rows by 2026-11-25) because nothing pruned it; the audit migration does. This keeps
 * that from being deleted or loosened by accident.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

describe("request_counts pruning", () => {
  const sql = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).map((n) => readFileSync(join(MIGRATIONS, n), "utf8")).join("\n");

  it("has a prune function that only the service role may run", () => {
    expect(sql).toMatch(/function public\.prune_request_counts\(\)/);
    expect(sql).toMatch(/revoke all on function public\.prune_request_counts\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.prune_request_counts\(\) to service_role/);
  });

  it("keeps at least a day of counters, because the daily card caps are keyed by UTC day", () => {
    const match = /window_start < \(extract\(epoch from now\(\) - interval '(\d+) days?'\)/.exec(sql.slice(sql.indexOf("prune_request_counts")));
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2);
  });

  it("is scheduled", () => {
    expect(sql).toMatch(/cron\.schedule\('request-counts-prune'/);
  });
});
