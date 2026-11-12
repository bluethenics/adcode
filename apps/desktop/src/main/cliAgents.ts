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
import { access, constants } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { CLI_AGENTS, codexPageRequest, isSafeCliToken, mergeCliModels, modelRequest, parseClaudeModels, parseCodexModels, parseModelList, type CliAgentId, type CliAgentSpec, type CliModelInfo, type CliProcess, type CliSpawn } from "@adcode/ai";
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
  const env = { ...process.env, NO_COLOR: "1", ...Object.fromEntries(Object.entries(extra).filter(([name]) => /^[A-Z][A-Z0-9_]{1,63}$/.test(name))) };
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

async function view(spec: CliAgentSpec, home: string): Promise<CliAgentView> {
  const path = await resolveCommand(spec.command);
  paths.set(spec.id, path);
  const version = path === null ? null : (await capture(path, ["--version"], home, VERSION_TIMEOUT_MS))?.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? null;
  return {
    id: spec.id, name: spec.name, command: spec.command, installed: path !== null, version, headless: spec.headless,
    signIn: spec.signIn, install: spec.install, docs: spec.docs,
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
