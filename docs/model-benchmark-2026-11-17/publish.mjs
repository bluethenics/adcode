/**
 * Puts the real-model report into the website's November reports (apps/web/src/lib/reports202611.ts)
 * of a given checkout, and points the 14 November benchmark's speed caveat at it.
 * Usage: node publish.mjs <checkoutRoot> <report.md>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, reportFile] = process.argv.slice(2);
if (root === undefined || reportFile === undefined) throw new Error("usage: publish.mjs <checkoutRoot> <report.md>");
const file = join(root, "apps", "web", "src", "lib", "reports202611.ts");
let source = readFileSync(file, "utf8");
const body = readFileSync(reportFile, "utf8").trim().replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const description = "ADCode, Claude Code and OpenCode on four real coding tasks with one real model: tasks solved, model time against harness time, tokens billed and cost per solved task with the provider's cache counted.";

const report = `const realModel: Report = {
  slug: "real-model-coding-agent-benchmark",
  title: "Real-model benchmark: ADCode, Claude Code and OpenCode on real coding tasks",
  description:
    ${JSON.stringify(description)},
  published: "2026-11-18",
  surface: "docs",
  section: "Comparisons",
  order: 0,
  related: ["coding-agent-token-benchmark", "adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],
  body: \`
${body}
\`,
};

`;
if (source.includes('slug: "real-model-coding-agent-benchmark"')) {
  source = source.replace(/const realModel: Report = \{[\s\S]*?\n\};\n\n/, report);
} else {
  source = source.replace("const benchmark: Report = {", `${report}const benchmark: Report = {`);
  source = source.replace("export const REPORTS_2026_11: readonly Report[] = [benchmark,", "export const REPORTS_2026_11: readonly Report[] = [realModel, benchmark,");
}
const oldLimit = "- Speed excludes the model. With a real model, its thinking time adds to every agent equally.";
if (source.includes(oldLimit)) {
  source = source.replace(oldLimit, "- Speed excludes the model. [The real-model benchmark](/docs/real-model-coding-agent-benchmark) measures the model's time, task success and cache-adjusted cost separately.");
}
source = source.replace('order: 0,\n  related: ["adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],', 'order: 1,\n  related: ["real-model-coding-agent-benchmark", "adcode-vs-claude-code-codex-opencode-t3-code", "adcode-2-6-1-fewer-tokens"],');
if (!source.includes("[realModel, benchmark,")) throw new Error("the report list did not take the new report");
writeFileSync(file, source);
console.log("published into", file);
