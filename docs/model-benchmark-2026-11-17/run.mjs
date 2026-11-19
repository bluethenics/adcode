/**
 * Runs every harness on every task against the benchmark proxy (a real model), then checks the
 * work: the task's own test file must pass, and must be byte-for-byte the file it started as.
 *
 * Usage: node run.mjs [reps] [harness,harness]   (proxy.mjs must already be listening on 8790)
 * Results are appended to runs/results.jsonl; analyze.mjs reads them with runs/log.jsonl.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dirname;
const PROXY = "http://127.0.0.1:8790";
const REPS = Number(process.argv[2] ?? 2);
const ONLY = process.argv[3]?.split(",") ?? null;
const ONLY_TASKS = process.argv[4]?.split(",") ?? null;
const TIMEOUT_MS = 420_000;
/** Runs, logs and the CLIs' private homes live outside the repository: they are large and local. */
const DATA = process.env["BENCH_DATA"] ?? join(HERE, "..", "..", "..", "adcode-bench-data", "model-benchmark-2026-11-17");
const RUNS = join(DATA, "runs");
mkdirSync(RUNS, { recursive: true });

const TASKS = [
  { id: "cart", test: "test/cart.test.js", prompt: "The tests in test/cart.test.js fail. Fix the bug in src/cart.js so they pass. Do not change any test. Run the tests to check before you finish." },
  { id: "slug", test: "test/slug.test.js", prompt: "Implement slugify in src/slug.js so test/slug.test.js passes. Do not change any test. Run the tests to check before you finish." },
  { id: "duration", test: "test/duration.test.js", prompt: "Implement parseDuration in src/duration.js so test/duration.test.js passes. Do not change any test. Run the tests to check before you finish." },
  { id: "format", test: "test/format.test.js", prompt: "test/format.test.js fails. Find and fix the bugs in src/ so it passes. Do not change any test. Run the tests to check before you finish." },
  // Added 18 November: harder tasks - a parser, async control flow, a data structure from a spec,
  // and a rename across three files.
  { id: "csv", test: "test/csv.test.js", prompt: "parseCsvLine in src/csv.js breaks on quoted fields. Fix it so test/csv.test.js passes. Do not change any test. Run the tests to check before you finish." },
  { id: "retry", test: "test/retry.test.js", prompt: "test/retry.test.js fails. Fix the bugs in src/retry.js so it passes. Do not change any test. Run the tests to check before you finish." },
  { id: "lru", test: "test/lru.test.js", prompt: "Implement LruCache in src/lru.js as its comment describes, so test/lru.test.js passes. Do not change any test. Run the tests to check before you finish." },
  { id: "rename", test: "test/shop.test.js", prompt: "Rename getPrice to priceOf everywhere in src/shop/, so test/shop.test.js passes. Do not change any test. Run the tests to check before you finish." },
];
/** Which tasks a published set ran: the first four from 17 November, all eight from 18 November. */
export const TASK_SETS = { original: ["cart", "slug", "duration", "format"], harder: ["csv", "retry", "lru", "rename"] };

// Isolated homes: no user instructions, memories or plugins, the same as the 14 November run.
const homes = join(DATA, "homes");
mkdirSync(join(homes, "claude"), { recursive: true });
mkdirSync(join(homes, "opencode", "config", "opencode"), { recursive: true });
const opencodeConfig = join(homes, "opencode", "config", "opencode", "opencode.json");
writeFileSync(opencodeConfig, JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  provider: { bench: { npm: "@ai-sdk/openai-compatible", name: "Bench", options: { baseURL: `${PROXY}/v1`, apiKey: "bench" }, models: { "bench-model": { name: "Bench model" } } } },
  permission: { edit: "allow", bash: "allow", webfetch: "deny" },
  autoupdate: false, share: "disabled",
}, null, 2));

/** Every environment starts clean of this machine's own AI settings. */
function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_|OPENAI_|OPENCODE_)/.test(key)) delete env[key];
  return { ...env, ...extra };
}

const HARNESSES = {
  adcode: (dir, task) => ({ cmd: process.execPath, args: [join(HERE, "adcode.mjs"), dir, `${PROXY}/v1`, task.prompt], env: cleanEnv({}) }),
  // Experiment only: ADCode with the workspace context ahead of its instructions.
  adcodectx: (dir, task) => ({ cmd: process.execPath, args: [join(HERE, "adcode.mjs"), dir, `${PROXY}/v1`, task.prompt], env: cleanEnv({ BENCH_CONTEXT_FIRST: "1" }) }),
  claude: (_dir, task) => ({ cmd: "claude", args: ["-p", task.prompt, "--output-format", "text", "--dangerously-skip-permissions", "--model", "claude-sonnet-5-5"], env: cleanEnv({ CLAUDE_CONFIG_DIR: join(homes, "claude"), ANTHROPIC_BASE_URL: PROXY, ANTHROPIC_API_KEY: "sk-ant-bench-key", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }) }),
  opencode: (_dir, task) => ({ cmd: "opencode", args: ["run", "-m", "bench/bench-model", task.prompt], env: cleanEnv({ XDG_CONFIG_HOME: join(homes, "opencode", "config"), XDG_DATA_HOME: join(homes, "opencode", "data"), XDG_STATE_HOME: join(homes, "opencode", "state"), OPENCODE_CONFIG: opencodeConfig }) }),
};

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Every file of the template, hashed: a run that writes outside its own copy stops the benchmark. */
const templateHash = () => createHash("sha256").update(["src/cart.js", "src/slug.js", "src/duration.js", "src/format.js", "src/round.js", "src/csv.js", "src/retry.js", "src/lru.js", "src/shop/prices.js", "src/shop/order.js", "src/shop/invoice.js", ...TASKS.map((task) => task.test)].map((file) => readFileSync(join(HERE, "project", file))).join("|")).digest("hex");
const TEMPLATE = templateHash();

function runOnce(harness, task, rep) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), `bench-${harness}-${task.id}-`));
    cpSync(join(HERE, "project"), dir, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["-c", "user.email=bench@example.com", "-c", "user.name=bench", "add", "-A"], { cwd: dir });
    spawnSync("git", ["-c", "user.email=bench@example.com", "-c", "user.name=bench", "commit", "-qm", "start"], { cwd: dir });
    const testHash = sha(join(dir, task.test));
    const name = `${harness}-${task.id}-r${String(rep)}`;
    void fetch(`${PROXY}/__run?name=${encodeURIComponent(name)}`).then(() => {
      const spec = HARNESSES[harness](dir, task);
      // A shell's PWD outranks the real working directory for some CLIs (OpenCode): found on
      // 17 November, when one edited this folder's template instead of its own copy.
      spec.env = { ...spec.env, PWD: dir, INIT_CWD: dir, OLDPWD: dir };
      const started = Date.now();
      let output = "";
      // On Windows the CLIs are .cmd shims, which need a shell - and a shell splits unquoted arguments.
      const viaShell = process.platform === "win32" && spec.cmd !== process.execPath;
      const args = viaShell ? spec.args.map((arg) => `"${arg.replace(/"/g, "\\\"")}"`) : spec.args;
      const child = spawn(spec.cmd, args, { cwd: dir, env: spec.env, shell: viaShell, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (c) => { output += c; });
      child.stderr.on("data", (c) => { output += c; });
      // Kill the whole tree first: killing the shell alone orphans the CLI, which keeps the pipes open.
      let settled = false;
      const timer = setTimeout(() => {
        output += "\n[benchmark] timed out";
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]); else child.kill("SIGKILL");
        // If the pipes still never close, finish the run anyway.
        setTimeout(() => { if (!settled) child.emit("close", null); }, 10_000);
      }, TIMEOUT_MS);
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const ended = Date.now();
        const check = spawnSync(process.execPath, ["--test", task.test], { cwd: dir, encoding: "utf8", timeout: 60_000 });
        const testsPass = check.status === 0;
        const testUntouched = sha(join(dir, task.test)) === testHash;
        if (templateHash() !== TEMPLATE) { console.error(`${name} changed the template project outside its own copy - stopping.`); process.exit(2); }
        const result = { run: name, harness, task: task.id, rep, started, ended, wallMs: ended - started, exit: code, timedOut: output.includes("[benchmark] timed out"), testsPass, testUntouched, success: testsPass && testUntouched, dir };
        writeFileSync(join(RUNS, `${name}.out.txt`), output.slice(-20_000));
        appendFileSync(join(RUNS, "results.jsonl"), `${JSON.stringify(result)}\n`);
        console.log(`${name}: ${result.success ? "PASS" : "fail"} in ${String(Math.round(result.wallMs / 1000))}s${result.timedOut ? " (timed out)" : ""}${testUntouched ? "" : " (tests changed!)"}`);
        resolve(result);
      });
    });
  });
}

const order = Object.keys(HARNESSES).filter((name) => ONLY === null ? name !== "adcodectx" : ONLY.includes(name));
// BENCH_START_REP adds more repetitions to an existing set without reusing run names.
const START_REP = Number(process.env["BENCH_START_REP"] ?? 1);
for (let rep = START_REP; rep < START_REP + REPS; rep += 1) {
  // Interleaved, so a slow hour on the model side hurts every harness alike.
  for (const task of TASKS.filter((one) => ONLY_TASKS === null || ONLY_TASKS.includes(one.id))) for (const harness of order) await runOnce(harness, task, rep);
}
console.log("done");
