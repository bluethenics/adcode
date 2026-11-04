/**
 * Can every plan on sale actually be checked out?
 *
 * Max went on sale with a checkout guard that still listed weekly/monthly/pro. The claim raised
 * inside Postgres, the API's catch-all answered 503 "Included AI is temporarily unavailable",
 * and every route test stayed green because they run on the memory store. This reads the
 * migrations as text and checks the final guard against the plan catalogue.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS_ON_SALE } from "../src/aiPlans.ts";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
const sql = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), "utf8").replace(/--[^\n]*/g, ""));

/** The plan list in the last match of `pattern` across all migrations. */
function lastPlanList(pattern: RegExp): string[] {
  let found: string | undefined;
  for (const text of sql) for (const match of text.matchAll(pattern)) found = match[1];
  expect(found, `no match for ${pattern}`).toBeDefined();
  return [...found!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
}

describe("plan checkout guards", () => {
  it("the checkout claim function accepts every plan on sale", () => {
    const body = /function public\.claim_ai_plan_checkout[\s\S]*?p_plan not in \(([^)]*)\)/gi;
    const allowed = lastPlanList(body);
    for (const plan of PLANS_ON_SALE) expect(allowed).toContain(plan.id);
  });

  it("the checkout table accepts every plan on sale", () => {
    const check = /ai_plan_checkouts[\s\S]{0,200}?check \(plan in \(([^)]*)\)\)/gi;
    const allowed = lastPlanList(check);
    for (const plan of PLANS_ON_SALE) expect(allowed).toContain(plan.id);
  });
});
