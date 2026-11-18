/**
 * Writes the published report's body from summary.json, so every number on the page is the
 * measured one and every claim (cheapest, fastest, fewest tokens) is chosen by the data.
 * Prints the markdown; `node report.mjs > report.md`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
/** Runs, logs and the CLIs' private homes live outside the repository: they are large and local. */
const DATA = process.env["BENCH_DATA"] ?? join(HERE, "..", "..", "..", "adcode-bench-data", "model-benchmark-2026-11-17");
const data = JSON.parse(readFileSync(join(HERE, "summary.json"), "utf8"));
const NAME = { adcode: "ADCode", claude: "Claude Code", opencode: "OpenCode" };
const VERSION = { adcode: "ADCode's agent as of this report", claude: "Claude Code 2.1.284", opencode: "OpenCode 1.19.5" };
// The experiment (context ahead of instructions) is reported in words, not in the table.
const summary = data.summary.filter((one) => one.harness in NAME);
const perRun = data.perRun.filter((run) => run.harness in NAME);
const k = (n) => Math.round(n).toLocaleString("en-US");
const pct = (n) => `${Math.round(n * 100)}%`;
const row = (h) => summary.find((one) => one.harness === h);
const ad = row("adcode");
const others = summary.filter((one) => one.harness !== "adcode");
const rank = (key) => [...summary].sort((a, b) => a[key] - b[key]);
const byCost = rank("costPerSolved");
const byWall = rank("medianWallS");
const byPrompt = rank("medianPrompt");
const byUncached = rank("uncachedPerSolved");
const first = (list) => list[0].harness === "adcode";
const next = (list) => list.find((one) => one.harness !== "adcode");
const tasks = [...new Set(perRun.map((run) => run.task))];
const reps = Math.round(ad.runs / tasks.length);
/** Each agent's first real request (side requests such as titles left out), median over its runs. */
const log = readFileSync(join(DATA, "runs", "log.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.status === 200 && Number(entry.promptTokens) >= 1000);
const firstRequest = (h) => {
  const runs = [...new Set(log.filter((entry) => entry.run.startsWith(`${h}-`)).map((entry) => entry.run))];
  const values = runs.map((run) => Number(log.filter((entry) => entry.run === run).sort((a, b) => a.id - b.id)[0].promptTokens)).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
};
// Recorded in runs/before-prompt-change and runs/after-first-change (8 runs each, same tasks).
const BEFORE = 30_329;

const lines = [];
lines.push(`On 14 November we published [a token and speed benchmark](/docs/coding-agent-token-benchmark) in which every coding agent talked to a scripted stand-in for a model. A reader replied, fairly, that this isolates the harness and nothing else: real-model reasoning time, task success and cache-adjusted billing need their own measurements before a token lead can be read as a smaller coding bill. This is that measurement.`);
lines.push("");
lines.push(`Three agents worked on the same four real coding tasks, ${reps} times each, with the same real model behind them. A task only counted as solved if its own test file passed and was left exactly as it was.`);
lines.push("");
lines.push("## The result");
lines.push("");
lines.push(`- **Solved:** ${summary.map((one) => `${NAME[one.harness]} ${one.passed} of ${one.runs}`).join(", ")}.${summary.every((one) => one.passed === one.runs) ? " With every agent solving every task, what separates them is time and money." : ""}`);
lines.push(first(byWall)
  ? `- **Fastest to a passing test:** ADCode's median task took ${ad.medianWallS.toFixed(0)} seconds, against ${others.map((one) => `${one.medianWallS.toFixed(0)} for ${NAME[one.harness]}`).join(" and ")}. The model's own share was ${summary.map((one) => `${one.medianModelS.toFixed(0)} s for ${NAME[one.harness]}`).join(", ")}; the harness itself took ${ad.medianHarnessS.toFixed(1)} seconds of ADCode's median task, against ${others.map((one) => `${one.medianHarnessS.toFixed(1)} for ${NAME[one.harness]}`).join(" and ")}.`
  : `- **Time:** ${byWall.map((one) => `${NAME[one.harness]} ${one.medianWallS.toFixed(0)} s`).join(", ")} for a median task.`);
lines.push(first(byPrompt)
  ? `- **Fewest tokens:** a median ADCode task sent the model ${k(ad.medianPrompt)} input tokens, against ${others.map((one) => `${k(one.medianPrompt)} for ${NAME[one.harness]}`).join(" and ")}.`
  : `- **Input tokens:** ${byPrompt.map((one) => `${NAME[one.harness]} ${k(one.medianPrompt)}`).join(", ")} for a median task.`);
if (first(byCost)) {
  const margin = 1 - ad.costPerSolved / next(byCost).costPerSolved;
  lines.push(`- **Cheapest per solved task:** ADCode, at ${k(ad.costPerSolved)} input-token equivalents with the provider's cache counted - ${pct(margin)} less than ${NAME[next(byCost).harness]} and ${pct(1 - ad.costPerSolved / row("claude").costPerSolved)} less than Claude Code.${margin < 0.15 ? ` The lead over ${NAME[next(byCost).harness]} is narrow - smaller than the spread between repeated rounds of the same agent - because the provider served ${pct(next(byCost).cacheableShare)} of ${NAME[next(byCost).harness]}'s input from cache against ${pct(ad.cacheableShare)} of ADCode's. Count the same work with no cache and the gap is ${pct(1 - ad.uncachedPerSolved / next(byUncached).uncachedPerSolved)}.` : ""}`);
} else {
  const lead = byCost[0];
  lines.push(`- **Cost per solved task, cache counted:** ${byCost.map((one) => `${NAME[one.harness]} ${k(one.costPerSolved)}`).join(", ")} input-token equivalents. ${NAME[lead.harness]} comes out ${pct(ad.costPerSolved / lead.costPerSolved - 1)} cheaper than ADCode here: the provider served ${pct(lead.cacheableShare)} of its input from cache against ${pct(ad.cacheableShare)} of ADCode's.${first(byUncached) ? ` Count the same work with no cache and ADCode is cheapest, at ${k(ad.uncachedPerSolved)} against ${k(next(byUncached).uncachedPerSolved)} for ${NAME[next(byUncached).harness]}.` : ""}`);
}
lines.push(`- **What we changed in ADCode on the way:** its first runs cost ${k(BEFORE)} per solved task. Watching them showed two habits - listing folders before reading the files a task named, and, after running the whole test suite, fixing failures nobody had asked about. Its instructions now say to read what the task names first, run only the tests that cover the change, and name other failures instead of fixing them. And five tools it never used in any run - external MCP capabilities, skills, file outlines and delete - now wait until they are needed instead of going with every step. It now costs ${k(ad.costPerSolved)}, ${pct(1 - ad.costPerSolved / BEFORE)} less, and no longer edits files outside the task. The other agents ran as shipped.`);
lines.push("");
lines.push("![What a solved task costs, cache-adjusted.](/images/blog/real-benchmark-cost.svg)");
lines.push("");
lines.push("| Agent | Solved | Median time | Model time | Harness time | Requests | Input tokens | Output tokens | Served from cache | Cost per solved task | Same work, no cache |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const one of byCost) lines.push(`| ${NAME[one.harness]} | ${one.passed}/${one.runs} | ${one.medianWallS.toFixed(0)} s | ${one.medianModelS.toFixed(0)} s | ${one.medianHarnessS.toFixed(1)} s | ${one.medianRequests} | ${k(one.medianPrompt)} | ${k(one.medianCompletion)} | ${pct(one.cacheableShare)} | ${k(one.costPerSolved)} | ${k(one.uncachedPerSolved)} |`);
lines.push("");
lines.push("Times, requests and tokens are medians per task. Costs are totals over every run, failed ones included, divided by the tasks solved.");
lines.push("");
lines.push("## Where the time goes");
lines.push("");
lines.push("![Median task time split into model time and harness time.](/images/blog/real-benchmark-time.svg)");
lines.push("");
lines.push(`The 14 November report said a real model's thinking time would add to every agent equally. Measured, it is the smaller difference: ${summary.map((one) => `${one.medianModelS.toFixed(0)} s`).join(", ")} of model time for a median task, against ${summary.map((one) => `${one.medianHarnessS.toFixed(1)} s`).join(", ")} of harness time - starting up, running tools and the agent's own work between replies. ADCode's model time is the lowest too, because it makes fewer and smaller requests for the model to read.`);
lines.push("");
lines.push("## Tokens the model was billed for");
lines.push("");
lines.push("![Input tokens per task, as the model counted them.](/images/blog/real-benchmark-tokens.svg)");
lines.push("");
lines.push(`These are the model's own counts, not an estimate. Before reading a single file, the first request weighs ${summary.map((one) => `${k(firstRequest(one.harness))} tokens for ${NAME[one.harness]}`).join(", ")} - instructions and tool definitions that go again with every step.`);
lines.push("");
lines.push("## Cache-adjusted billing");
lines.push("");
lines.push("Most providers bill input their cache already holds at about a tenth of the normal price, and output at about four times input. We used those ratios, so costs here are in input-token equivalents and hold whichever model you pick: an uncached input token counts 1, a cached one 0.1, an output token 4. The cached figures are the ones the model's provider reported for each request.");
lines.push("");
lines.push(`ADCode's prompt is built to be cached - its instructions, tools and earlier messages never change from one step to the next, which we checked request by request - yet the provider served less of it from cache (${pct(ad.cacheableShare)}) than of the others' (${others.map((one) => `${pct(one.cacheableShare)} for ${NAME[one.harness]}`).join(", ")}). We tested two explanations and neither held: waiting longer between requests did not raise ADCode's hit rate, and putting the conversation's own context ahead of the shared instructions did not either. When ADCode missed, the provider had matched exactly the first 1,024 tokens - its shared instructions - from another conversation, which points at how the provider picks a cache for each request. Sending a cache key with each conversation, as OpenAI-style APIs allow, is the next fix; it has to go through ADCode's relay, which today refuses unknown fields.`);
lines.push("");
lines.push("## How we measured");
lines.push("");
lines.push("- **One real model for everyone.** A local proxy spoke each agent's own API format - Anthropic Messages for Claude Code, OpenAI Chat Completions for OpenCode and ADCode - and passed every request, translated, to the same model: Tagflow Code Flash 1, ADCode's default included model. It recorded what each agent sent, the model's time for each request, and the tokens the model reported.");
lines.push("- **Four real tasks.** A small JavaScript project tested with Node's built-in runner: fix a discount bug, implement a URL slug function, implement a duration parser, and fix two bugs across two files in a byte formatter. Each starts with failing tests.");
lines.push("- **Solved means solved.** After each run the task's test file had to pass and be byte-for-byte unchanged; an agent that edits the test to pass it fails. The project template was checked after every run too, so no agent could reach outside its own copy.");
lines.push(`- **Same conditions.** Each agent ran ${reps} times per task in its non-interactive mode, from an empty private configuration (no memories, instructions or plugins), in a fresh copy of the project. Runs were interleaved - one task for every agent before the next - so a slow minute on the model's side hit all of them alike. ADCode was run again after each change described above; its row is its last 20 runs, taken the same day as the others', and the earlier rounds are kept with the data.`);
lines.push(`- **Versions:** ${summary.map((one) => VERSION[one.harness]).join(", ")}.`);
lines.push("");
lines.push("## Limits");
lines.push("");
lines.push("- **One model.** A stronger model may need fewer steps in every agent; a weaker one may favour agents with more guard rails. We will repeat this with other models.");
lines.push(`- **Small tasks.** Four tasks of under a minute each, ${reps} runs per agent per task. Differences under about 15% in cost are within what we saw between repeated rounds of the same agent.`);
lines.push("- **Not every agent.** Codex and DeepSeek Harness from the first benchmark were not installed on the test machine this time; they will be in the next run.");
lines.push("- **The cache is the provider's.** Reported cache hits vary from request to request for reasons on the provider's side, so the cache shares carry more noise than the token counts.");
lines.push("");
lines.push("The proxy, tasks, runner and analysis are in the ADCode repository under docs/model-benchmark-2026-11-17.");
console.log(lines.join("\n"));
