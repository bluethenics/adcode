/**
 * Reads runs/results.jsonl (what each harness achieved) and runs/log.jsonl (every model request,
 * from the proxy) and writes summary.json plus the tables for the report.
 *
 * - Success: the task's own test file passes and is byte-for-byte unchanged.
 * - Model time: the sum of the model's own request times in a run; harness time is the rest of
 *   the wall clock (startup, tools, the harness's own work).
 * - Tokens: what the model reports it was billed for (prompt and completion).
 * - Cached: the prompt tokens the model's provider reported serving from its prefix cache
 *   (prompt_tokens_details.cached_tokens). A character-prefix estimate was tried first and
 *   dropped: the proxy's JSON puts the tool list after the growing message list, so it
 *   undercounted what the provider, which caches in prompt order, actually reused.
 * - Cache-adjusted cost, in input-token equivalents: uncached input x1, cached input x0.1,
 *   output x4 - the ratios most providers price at - so it holds whichever model is used.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
/** Runs, logs and the CLIs' private homes live outside the repository: they are large and local. */
const DATA = process.env["BENCH_DATA"] ?? join(HERE, "..", "..", "..", "adcode-bench-data", "model-benchmark-2026-11-17");
const lines = (file) => readFileSync(join(DATA, "runs", file), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const results = lines("results.jsonl");
const requests = lines("log.jsonl").filter((entry) => entry.run !== undefined && entry.status !== undefined);
const median = (values) => { const v = [...values].sort((a, b) => a - b); return v.length === 0 ? 0 : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const sum = (values) => values.reduce((a, b) => a + b, 0);

const perRun = results.map((result) => {
  const mine = requests.filter((entry) => entry.run === result.run);
  const prompt = sum(mine.map((entry) => Number(entry.promptTokens ?? entry.sentTokensEstimate)));
  const completion = sum(mine.map((entry) => Number(entry.completionTokens ?? 0)));
  const cacheable = sum(mine.map((entry) => Number(entry.cachedTokens ?? 0)));
  const modelMs = sum(mine.map((entry) => entry.modelMs ?? 0));
  return {
    ...result, requests: mine.length, prompt, completion, cacheable, modelMs,
    harnessMs: Math.max(0, result.wallMs - modelMs),
    costUnits: (prompt - cacheable) + 0.1 * cacheable + 4 * completion,
    /** The same work with no cache at all: the ceiling a provider without caching would bill. */
    uncachedUnits: prompt + 4 * completion,
    errors: mine.filter((entry) => entry.status !== 200).length,
  };
});

const harnesses = [...new Set(perRun.map((run) => run.harness))];
const summary = harnesses.map((harness) => {
  const runs = perRun.filter((run) => run.harness === harness);
  const passed = runs.filter((run) => run.success);
  return {
    harness,
    runs: runs.length,
    passed: passed.length,
    successRate: runs.length === 0 ? 0 : passed.length / runs.length,
    medianWallS: median(runs.map((run) => run.wallMs)) / 1000,
    medianModelS: median(runs.map((run) => run.modelMs)) / 1000,
    medianHarnessS: median(runs.map((run) => run.harnessMs)) / 1000,
    medianRequests: median(runs.map((run) => run.requests)),
    medianPrompt: median(runs.map((run) => run.prompt)),
    medianCompletion: median(runs.map((run) => run.completion)),
    cacheableShare: sum(runs.map((run) => run.cacheable)) / Math.max(1, sum(runs.map((run) => run.prompt))),
    medianCostUnits: median(runs.map((run) => run.costUnits)),
    /** Cost per solved task: every run's spend, failures included, over the tasks solved. */
    costPerSolved: passed.length === 0 ? null : sum(runs.map((run) => run.costUnits)) / passed.length,
    uncachedPerSolved: passed.length === 0 ? null : sum(runs.map((run) => run.uncachedUnits)) / passed.length,
    totalModelS: sum(runs.map((run) => run.modelMs)) / 1000,
    totalHarnessS: sum(runs.map((run) => run.harnessMs)) / 1000,
    testsTampered: runs.filter((run) => !run.testUntouched).length,
    timeouts: runs.filter((run) => run.timedOut).length,
  };
}).sort((a, b) => b.successRate - a.successRate || (a.costPerSolved ?? Infinity) - (b.costPerSolved ?? Infinity));

writeFileSync(join(HERE, "summary.json"), `${JSON.stringify({ summary, perRun: perRun.map(({ dir: _dir, ...rest }) => rest) }, null, 2)}\n`);
const k = (n) => Math.round(n).toLocaleString("en-US");
console.log("| Harness | Solved | Median wall | of which model | of which harness | Requests | Prompt tokens | Output tokens | Cached (reported) | Cost per solved task | Without any cache |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const row of summary) {
  console.log(`| ${row.harness} | ${row.passed}/${row.runs} | ${row.medianWallS.toFixed(0)} s | ${row.medianModelS.toFixed(0)} s | ${row.medianHarnessS.toFixed(1)} s | ${row.medianRequests} | ${k(row.medianPrompt)} | ${k(row.medianCompletion)} | ${(row.cacheableShare * 100).toFixed(0)}% | ${row.costPerSolved === null ? "-" : k(row.costPerSolved)} | ${row.uncachedPerSolved === null ? "-" : k(row.uncachedPerSolved)} |`);
}
