/**
 * The broadened run (18 November): reads summary-<model>.json for each model analysed and
 * prints one table per model plus the per-task success grid, for the report.
 * Usage: node combine.mjs model [model...]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const NAME = { adcode: "ADCode", claude: "Claude Code", opencode: "OpenCode" };
const k = (n) => (n === null ? "-" : Math.round(n).toLocaleString("en-US"));
for (const model of process.argv.slice(2)) {
  const { summary, perRun } = JSON.parse(readFileSync(join(HERE, `summary-${model}.json`), "utf8"));
  console.log(`\n### ${model}\n`);
  console.log("| Agent | Solved | Median time | Model time | Harness time | Input tokens | Served from cache | Cost per solved task | Same work, no cache |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const row of summary) console.log(`| ${NAME[row.harness] ?? row.harness} | ${row.passed}/${row.runs} | ${row.medianWallS.toFixed(0)} s | ${row.medianModelS.toFixed(0)} s | ${row.medianHarnessS.toFixed(1)} s | ${k(row.medianPrompt)} | ${(row.cacheableShare * 100).toFixed(0)}% | ${k(row.costPerSolved)} | ${k(row.uncachedPerSolved)} |`);
  const tasks = [...new Set(perRun.map((run) => run.task))];
  console.log(`\n| Task | ${summary.map((row) => NAME[row.harness] ?? row.harness).join(" | ")} |`);
  console.log(`|---|${summary.map(() => "---").join("|")}|`);
  for (const task of tasks) console.log(`| ${task} | ${summary.map((row) => { const runs = perRun.filter((run) => run.task === task && run.harness === row.harness); return `${runs.filter((run) => run.success).length}/${runs.length}`; }).join(" | ")} |`);
}
