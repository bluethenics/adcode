/**
 * The coding CLIs installed on this computer, found and run for the assistant (cliAgents.ts in
 * packages/ai holds everything that can be tested without a process).
 *
 * Found on PATH, never assumed: a CLI counts as connected only when its executable is there
 * and answers `--version`. Run without a shell wherever possible; on Windows the npm shims are
 * `.cmd` files that need one, so every argument is checked against `isSafeCliToken` first and
 * the prompt itself only ever travels on stdin.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { delimiter, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { AcpConnection, CLI_AGENTS, acpInitializeParams, cliUpdateCommand, cliVersionNumber, isNewerCliVersion, parseAcpModels, type CliLiveProcess, type CliLiveSpawn, codexPageRequest, isSafeCliToken, mergeCliModels, modelRequest, parseClaudeModels, parseCodexModels, parseModelList, type CliAgentId, type CliAgentSpec, type CliModelInfo, type CliProcess, type CliSpawn } from "@adcode/ai";
import type { CliAgentView } from "../shared/api.ts";

const VERSION_TIMEOUT_MS = 8_000;
const LIST_TIMEOUT_MS = 30_000;
const DETECT_TTL_MS = 60_000;
const MODELS_TTL_MS = 10 * 60_000;
/** A turn that runs longer than this is stopped: the CLI is stuck, not thinking. */
const TURN_LIMIT_MS = 30 * 60_000;
const STDERR_KEEP = 4_000;
const isWindows = process.platform === "win32";

/** Where `name` would run from, as a shell would find it on PATH. */
export async function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(delimiter).filter(Boolean);
  const extensions = isWindows ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension.toLowerCase()}`);
      try {
        await access(candidate, isWindows ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch { /* Not here. */ }
    }
  }
  return null;
}

/**
 * The program an npm `.cmd` shim runs, when it is a plain executable: Claude Code's shim only
 * forwards to `claude.exe`. Started directly, it needs no cmd.exe in between - one process
 * fewer per turn, and no shell to read its arguments. Anything else keeps the shim.
 */
async function unwrapShim(path: string): Promise<string> {
  if (!needsShell(path)) return path;
  try {
    const text = await readFile(path, "utf8");
    const match = /^"%dp0%\\([^"%]+\.exe)"\s+%\*\s*$/im.exec(text);
    if (match === null || match[1]!.includes("..")) return path;
    const target = join(dirname(path), match[1]!);
    await access(target, constants.F_OK);
    return target;
  } catch {
    return path;
  }
}

/**
 * Variables that tell Claude Code it is running inside another Claude Code session. Inherited
 * (ADCode started from a Claude Code terminal), they make the child wait on its parent's
 * session and never answer; checked here: a `claude -p` given them said nothing for 3 minutes.
 */
const PARENT_SESSION = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|HOST_SESSION_ID|MESSAGING_SOCKET|MESSAGING_TOKEN|SDK_HAS_HOST_AUTH_REFRESH|SESSION_ATTENDED|EXECPATH)|CLAUDE_PID|CLAUDE_AGENT_SDK_VERSION)$/;

/** `.cmd` and `.bat` shims cannot be started without a shell on Windows. */
const needsShell = (path: string): boolean => isWindows && /^\.(cmd|bat)$/i.test(extname(path));

function quoteForCmd(value: string): string {
  return /^[A-Za-z0-9._:/@+=\\-]+$/.test(value) ? value : `"${value.replace(/"/g, "")}"`;
}

/** Ends the process and everything it started: a CLI's own tool runs are children of it. */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
  } else {
    child.kill("SIGTERM");
  }
}

function start(path: string, args: readonly string[], cwd: string, extra: Readonly<Record<string, string>> = {}): ChildProcess {
  if (args.some((arg) => arg !== "-" && !isSafeCliToken(arg) && !/^-{1,2}[a-z][a-z-]*$/i.test(arg))) throw new Error("Refusing an unsafe argument for a CLI agent.");
  // Only names ADCode itself sets (`cliEnv`): how a CLI finds ADCode's tools for this run.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !PARENT_SESSION.test(name)));
  const env = { ...inherited, NO_COLOR: "1", ...Object.fromEntries(Object.entries(extra).filter(([name]) => /^[A-Z][A-Z0-9_]{1,63}$/.test(name))) };
  return needsShell(path)
    ? spawn(`${quoteForCmd(path)} ${args.map(quoteForCmd).join(" ")}`, { cwd, shell: true, windowsHide: true, env })
    : spawn(path, [...args], { cwd, windowsHide: true, env });
}

/** Runs a short command to completion and returns its stdout, or null. */
function capture(path: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try { child = start(path, args, cwd); } catch { resolve(null); return; }
    let out = "";
    const timer = setTimeout(() => { killTree(child); resolve(null); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { if (out.length < 2_000_000) out += chunk.toString("utf8"); });
    child.stdin?.end();
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? out : null); });
  });
}

const paths = new Map<CliAgentId, string | null>();
let detected: { at: number; views: Promise<CliAgentView[]> } | null = null;
const listed = new Map<CliAgentId, { at: number; models: readonly CliModelInfo[] }>();
/** Asking a CLI for its models starts it; one ask per CLI at a time. */
const asking = new Map<CliAgentId, Promise<CliModelInfo[]>>();
/** Long enough for a cold start of a Node CLI on a slow disk; the picker shows the aliases meanwhile. */
const ASK_TIMEOUT_MS = 25_000;
const MAX_CODEX_PAGES = 6;

/** Forget the lists, so the next read asks again: after signing in, or pressing Look again. */
export function forgetCliModels(): void {
  listed.clear();
}

/**
 * Ask a running CLI for its models over its own protocol (`modelProtocol`), then stop it.
 * Starting Claude Code this way loads no model and sends no prompt: the answer to
 * `initialize` comes from its configuration and account. Null when it could not be asked.
 */
function askForModels(spec: CliAgentSpec, path: string, cwd: string): Promise<CliModelInfo[] | null> {
  const protocol = spec.modelProtocol;
  if (protocol === undefined) return Promise.resolve(null);
  if (protocol === "acp") return askAcpForModels(spec, path, cwd);
  const args = protocol === "claude-initialize" ? ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["app-server"];
  return new Promise((resolve) => {
    let child: ChildProcess;
    try { child = start(path, args, cwd); } catch { resolve(null); return; }
    const found: CliModelInfo[] = [];
    let settled = false;
    let page = 2;
    const finish = (models: CliModelInfo[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      resolve(models);
    };
    const timer = setTimeout(() => finish(found.length > 0 ? found : null), ASK_TIMEOUT_MS);
    child.on("error", () => finish(null));
    child.on("close", () => finish(found.length > 0 ? found : null));
    child.stdin?.on("error", () => undefined);
    const send = (message: unknown): void => { child.stdin?.write(`${JSON.stringify(message)}\n`); };
    if (child.stdout === null) { finish(null); return; }
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      let message: unknown;
      try { message = JSON.parse(line); } catch { return; }
      if (protocol === "claude-initialize") {
        const models = parseClaudeModels(message);
        if (models !== null) finish(models);
        return;
      }
      const reply = parseCodexModels(message);
      if (reply === null) return;
      found.push(...reply.models);
      if (reply.next !== null && page < MAX_CODEX_PAGES + 1) send(codexPageRequest(++page, reply.next));
      else finish(found);
    });
    for (const message of modelRequest(protocol)) send(message);
  });
}

/**
 * An ACP agent's models: `initialize`, then `session/new` in the home folder, whose answer
 * lists them for the signed-in account - then the process is stopped. OpenCode answers in
 * about 4.5 s; its old `opencode models` list command took up to 30 s.
 */
async function askAcpForModels(spec: CliAgentSpec, path: string, cwd: string): Promise<CliModelInfo[] | null> {
  void path;
  const process = spawnCliLive(spec.command, spec.acpArgs ?? [], { cwd });
  const connection = new AcpConnection(process);
  const timer = setTimeout(() => process.kill(), ASK_TIMEOUT_MS);
  try {
    await connection.request("initialize", acpInitializeParams());
    const models = parseAcpModels(await connection.request("session/new", { cwd, mcpServers: [] }));
    return models.length > 0 ? models : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    process.kill();
  }
}

const LATEST_TTL_MS = 6 * 60 * 60_000;
const LATEST_TIMEOUT_MS = 4_000;
const latestKnown = new Map<string, { at: number; version: string | null }>();

/**
 * The newest version of an installed agent on npm, from the public registry (the package name
 * only - nothing about the person or this computer is sent). Cached for six hours, a failure
 * for half an hour, and never waited on for more than four seconds.
 */
async function latestVersion(spec: CliAgentSpec): Promise<string | null> {
  const name = spec.npmPackage;
  if (name === undefined || cliUpdateCommand(spec) === null) return null;
  const known = latestKnown.get(name);
  if (known !== undefined && Date.now() - known.at < (known.version === null ? 30 * 60_000 : LATEST_TTL_MS)) return known.version;
  let version: string | null = null;
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (response.ok) version = cliVersionNumber(String(((await response.json()) as { version?: unknown }).version ?? ""));
  } catch { /* Offline or slow: no update is offered, which is the safe answer. */ }
  latestKnown.set(name, { at: Date.now(), version });
  return version;
}

async function view(spec: CliAgentSpec, home: string): Promise<CliAgentView> {
  const found = await resolveCommand(spec.command);
  const path = found === null ? null : await unwrapShim(found);
  paths.set(spec.id, path);
  // Its own version and npm's newest, side by side: neither waits for the other.
  const [version, latest] = path === null ? [null, null] : await Promise.all([
    capture(path, ["--version"], home, VERSION_TIMEOUT_MS).then((out) => out?.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? null),
    latestVersion(spec),
  ]);
  const update = isNewerCliVersion(version, latest) ? cliUpdateCommand(spec) : null;
  return {
    id: spec.id, name: spec.name, command: spec.command, installed: path !== null, version, headless: spec.headless,
    signIn: spec.signIn, install: spec.install, docs: spec.docs, latest, update,
  };
}

/** Every known CLI and whether this computer has it. Cached for a minute; `fresh` looks again. */
export function detectCliAgents(home: string, fresh = false): Promise<CliAgentView[]> {
  if (fresh || detected === null || Date.now() - detected.at > DETECT_TTL_MS) {
    detected = { at: Date.now(), views: Promise.all(CLI_AGENTS.map((spec) => view(spec, home))) };
  }
  return detected.views;
}

/**
 * The CLI's models, live: what it reports for the signed-in account (its list command, or its
 * own protocol), with the built-in aliases only when it could not be asked. Cached for ten
 * minutes, and asked at most once at a time.
 */
export async function cliModels(spec: CliAgentSpec, home: string): Promise<CliModelInfo[]> {
  const path = paths.get(spec.id);
  if (path === null || path === undefined || (spec.listModels === undefined && spec.modelProtocol === undefined)) return mergeCliModels(spec, []);
  const cached = listed.get(spec.id);
  if (cached !== undefined && Date.now() - cached.at < MODELS_TTL_MS) return mergeCliModels(spec, cached.models);
  let pending = asking.get(spec.id);
  if (pending === undefined) {
    pending = (async () => {
      let models: CliModelInfo[] | null;
      if (spec.listModels !== undefined) {
        const output = await capture(path, spec.listModels, home, LIST_TIMEOUT_MS);
        models = output === null ? null : parseModelList(output).map((id) => ({ id, name: id }));
      } else models = await askForModels(spec, path, home);
      // A failed ask is remembered briefly too, so a signed-out CLI is not restarted on every repaint.
      listed.set(spec.id, { at: models === null ? Date.now() - MODELS_TTL_MS + 60_000 : Date.now(), models: models ?? [] });
      return models ?? [];
    })().finally(() => asking.delete(spec.id));
    asking.set(spec.id, pending);
  }
  return mergeCliModels(spec, await pending);
}

/**
 * Which CLIs are installed, for starting a turn: the last answer at once, refreshed in the
 * background when it is older than a minute. Every chat turn used to wait for five `--version`
 * runs (up to 8 s each on a cold disk) once a minute had passed since the last look.
 */
export function detectCliAgentsQuick(home: string): Promise<CliAgentView[]> {
  if (detected === null) return detectCliAgents(home);
  const last = detected.views;
  if (Date.now() - detected.at > DETECT_TTL_MS) void detectCliAgents(home, true).catch(() => undefined);
  return last;
}

/**
 * The CLI's models for starting a turn: any list it gave before, even an old one, with a fresh
 * ask in the background; only the very first turn waits for the CLI to answer. A turn after ten
 * quiet minutes used to wait up to 30 s for `opencode models` before the CLI even started.
 */
export async function cliModelsQuick(spec: CliAgentSpec, home: string): Promise<CliModelInfo[]> {
  const cached = listed.get(spec.id);
  // Never asked yet: the turn starts on the built-in names while the CLI is asked alongside.
  // Waiting here started Claude Code twice for a first message - once to list its models,
  // once to answer - and the model the person picked is passed through either way.
  if (cached === undefined || Date.now() - cached.at >= MODELS_TTL_MS) void cliModels(spec, home).catch(() => undefined);
  return mergeCliModels(spec, cached?.models ?? []);
}

/**
 * The CLI's models without waiting: the last list it gave (or its built-in aliases), at once.
 * When that list is missing or stale, the CLI is asked in the background, and `onChange` runs
 * once the answer differs from what was returned. The model picker reads this, so an installed
 * CLI never holds the whole picker for the 25-30 s a cold ask can take.
 */
export function cliModelsNow(spec: CliAgentSpec, home: string, onChange: () => void): CliModelInfo[] {
  const path = paths.get(spec.id);
  if (path === null || path === undefined || (spec.listModels === undefined && spec.modelProtocol === undefined)) return mergeCliModels(spec, []);
  const cached = listed.get(spec.id);
  const now = mergeCliModels(spec, cached?.models ?? []);
  if (cached === undefined || Date.now() - cached.at >= MODELS_TTL_MS) {
    const before = JSON.stringify(now);
    void cliModels(spec, home).then((models) => { if (JSON.stringify(models) !== before) onChange(); }, () => undefined);
  }
  return now;
}

/** Every CLI kept running between turns, so quitting ADCode stops them all. */
const liveChildren = new Set<ChildProcess>();

/** Stops every kept CLI. For quitting: a kept process would otherwise outlive ADCode. */
export function stopLiveClis(): void {
  for (const child of liveChildren) killTree(child);
  liveChildren.clear();
}

/**
 * The spawn for a CLI kept between turns: stdin stays open for the next message, and stdout
 * lines queue until a turn takes them. Same command line rules as `spawnCli`.
 */
export const spawnCliLive: CliLiveSpawn = (command, args, options) => {
  const spec = CLI_AGENTS.find((agent) => agent.command === command);
  const path = spec === undefined ? null : paths.get(spec.id) ?? null;
  let stderr = "";
  const queue: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let closed = false;
  const close = (): void => { closed = true; for (const resolve of waiting.splice(0)) resolve(null); };
  const dead = (message: string): CliLiveProcess => ({ next: async () => null, send: () => undefined, alive: () => false, exit: Promise.resolve(path === null ? 127 : 1), stderr: () => message, kill: () => undefined });
  if (path === null) return dead(`${command} was not found on this computer. Install it, then choose it again.`);
  let child: ChildProcess;
  try {
    child = start(path, args, options.cwd, options.env);
  } catch (error) {
    return dead(error instanceof Error ? error.message : "It could not be started.");
  }
  liveChildren.add(child);
  child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEEP); });
  child.stdin?.on("error", () => undefined);
  const exit = new Promise<number | null>((resolve) => {
    child.on("error", (error) => { stderr += `\n${error.message}`; liveChildren.delete(child); close(); resolve(1); });
    child.on("close", (code) => { liveChildren.delete(child); close(); resolve(code); });
  });
  if (child.stdout === null) close();
  else createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const resolve = waiting.shift();
    if (resolve !== undefined) resolve(line);
    else queue.push(line);
  }).on("close", close);
  return {
    next: () => {
      const line = queue.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    send: (line) => { if (!closed && child.stdin?.writable === true) child.stdin.write(`${line}\n`, "utf8"); },
    alive: () => !closed && child.exitCode === null && child.signalCode === null,
    exit,
    stderr: () => stderr,
    kill: () => { killTree(child); liveChildren.delete(child); },
  };
};

/** The spawn the provider uses: stdout as lines, stdin the prompt, killed as a tree. */
export const spawnCli: CliSpawn = (command, args, options) => {
  const spec = CLI_AGENTS.find((agent) => agent.command === command);
  const path = spec === undefined ? null : paths.get(spec.id) ?? null;
  if (path === null) {
    const missing: CliProcess = { lines: (async function* () { /* nothing */ })(), exit: Promise.resolve(127), stderr: () => `${command} was not found on this computer. Install it, then choose it again.`, kill: () => undefined };
    return missing;
  }
  let stderr = "";
  let child: ChildProcess;
  try {
    child = start(path, args, options.cwd, options.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "It could not be started.";
    return { lines: (async function* () { /* nothing */ })(), exit: Promise.resolve(1), stderr: () => message, kill: () => undefined };
  }
  const limit = setTimeout(() => killTree(child), TURN_LIMIT_MS);
  child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEEP); });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(options.input, "utf8");
  const exit = new Promise<number | null>((resolve) => {
    child.on("error", (error) => { stderr += `\n${error.message}`; resolve(1); });
    child.on("close", (code) => { clearTimeout(limit); resolve(code); });
  });
  const lines = child.stdout === null ? (async function* () { /* nothing */ })() : createInterface({ input: child.stdout, crlfDelay: Infinity });
  return { lines, exit, stderr: () => stderr, kill: () => killTree(child) };
};
