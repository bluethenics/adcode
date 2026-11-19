/**
 * Agent rules and hooks, on this computer: the files, the questions, the commands.
 *
 * What decides lives in `@adcode/ai`'s toolRules, under test. This is the part that cannot:
 * reading `.adcode/settings.json` and `~/.adcode/settings.json` (re-read whenever either
 * changes, so an edit applies to the next call), asking the person in the app's own dialog,
 * and running hook commands with the call on stdin.
 *
 * A project's hooks are commands that arrive with the project - a cloned repository could
 * carry one that runs the moment a chat starts. So they run only once the person has seen
 * and approved that exact set, and are asked about again whenever it changes. The person's
 * own file in their home folder needs no approval; nobody else writes it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import {
  EMPTY_AGENT_SETTINGS,
  addAllowRule,
  stripJsonComments,
  describeRules,
  hooksFingerprint,
  mergeAgentSettings,
  parseAgentSettings,
  runEventHooks,
  settingsFileName,
  withToolPolicy,
  type AgentHook,
  type AgentPolicy,
  type AgentSettings,
  type HookRun,
  type PolicyQuestion,
  type RuleSource,
  type ToolRunner,
} from "@adcode/ai";
import { killTree, shellFor } from "./aiCommands.ts";
import { recordDebug } from "./debugLog.ts";
import { chooseInWindow, confirmInWindow } from "./themedConfirm.ts";
import { currentSettings } from "./settings.ts";
import { fullAccessApplies } from "./fullAccess.ts";

const askBeforeConnectorTools = (): boolean => currentSettings()["adcode.ai.askBeforeConnectorTools"] === true;

/** What one hook may print before the rest is dropped. */
const MAX_HOOK_OUTPUT = 64_000;

export const projectSettingsPath = (root: string): string => join(root, ".adcode", "settings.json");
export const userSettingsPath = (): string => join(homedir(), ".adcode", "settings.json");

/* ── The files ────────────────────────────────────────────────────────────── */

const cache = new Map<string, { readonly mtimeMs: number; readonly size: number; readonly settings: AgentSettings }>();

async function readSettings(path: string, source: RuleSource): Promise<AgentSettings> {
  let info;
  try {
    info = await stat(path);
  } catch {
    cache.delete(path);
    return EMPTY_AGENT_SETTINGS;
  }
  const hit = cache.get(path);
  if (hit !== undefined && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.settings;
  let settings: AgentSettings;
  try {
    settings = parseAgentSettings(await readFile(path, "utf8"), source);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code ?? "unknown error";
    settings = { ...EMPTY_AGENT_SETTINGS, unreadable: `${settingsFileName(source)} could not be read (${code})` };
  }
  cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, settings });
  if (settings.unreadable !== null) recordDebug("warn", "ai:rules", `${settings.unreadable}; changes ask first until it is fixed`);
  for (const problem of settings.problems) recordDebug("warn", "ai:rules", `${settingsFileName(source)}: ${problem}`);
  return settings;
}

/* ── Approving a project's hooks ──────────────────────────────────────────── */

const approvalsFile = (): string => join(app.getPath("userData"), "agent-hooks-approved.json");
let approvals: Record<string, string> | null = null;
/** Turned down this run: not asked again until the hooks change or the app restarts. */
const declined = new Set<string>();
/** One question per hook set, however many helpers reach it at once. */
const asking = new Map<string, Promise<boolean>>();

async function loadApprovals(): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(approvalsFile(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function describeHook(hook: AgentHook): string {
  const which = hook.matchers === null ? "" : ` (${hook.matchers.map((rule) => rule.text).join(", ")})`;
  return `${hook.event}${which}: ${hook.command}`;
}

const untilAborted = (signal: AbortSignal | undefined): Promise<false> =>
  new Promise((done) => {
    if (signal === undefined) return;
    if (signal.aborted) done(false);
    else signal.addEventListener("abort", () => done(false), { once: true });
  });

async function projectHooksApproved(root: string, hooks: readonly AgentHook[], signal?: AbortSignal): Promise<boolean> {
  /*
   * Full access covers an agent turn, but it must not leave a permanent approval behind:
   * the person trusted this run, not every launch from now on. The hooks answer yes for
   * this run without writing the approvals file.
   */
  if (fullAccessApplies(currentSettings())) return true;
  const fingerprint = createHash("sha256").update(hooksFingerprint(hooks)).digest("hex");
  const key = resolve(root).toLowerCase();
  approvals ??= await loadApprovals();
  if (approvals[key] === fingerprint) return true;
  const asked = `${key}\n${fingerprint}`;
  if (declined.has(asked)) return false;
  let answer = asking.get(asked);
  if (answer === undefined) {
    answer = confirmInWindow(BrowserWindow.getFocusedWindow(), {
      title: "Run this project's hooks?",
      body: [
        "This project's .adcode/settings.json asks ADCode's agents to run these commands on your computer:",
        "",
        ...hooks.map(describeHook),
        "",
        "Only allow this for a project you trust. You are asked again whenever they change.",
      ].join("\n"),
      confirmLabel: "Run them",
      cancelLabel: "Don't run",
    }).then(async (yes) => {
      asking.delete(asked);
      if (!yes) {
        declined.add(asked);
        recordDebug("info", "ai:hooks", "This project's hooks were not approved; they will not run");
        return false;
      }
      approvals = { ...(approvals ?? {}), [key]: fingerprint };
      await mkdir(dirname(approvalsFile()), { recursive: true });
      await writeFile(approvalsFile(), JSON.stringify(approvals, null, 2), "utf8").catch(() => undefined);
      return true;
    });
    asking.set(asked, answer);
  }
  // A stopped turn stops waiting, without counting as a no.
  return Promise.race([answer, untilAborted(signal)]);
}

/** Both files as written, before any hook is approved. */
async function readBoth(root: string | null): Promise<{ readonly user: AgentSettings; readonly project: AgentSettings }> {
  const userPath = userSettingsPath();
  const user = await readSettings(userPath, "user");
  // A project opened at the home folder has one file, and it is the person's own.
  const project = root === null || resolve(projectSettingsPath(root)).toLowerCase() === resolve(userPath).toLowerCase()
    ? EMPTY_AGENT_SETTINGS
    : await readSettings(projectSettingsPath(root), "project");
  return { user, project };
}

/** The rules and hooks in force for a project now. */
export async function agentPolicy(root: string | null, signal?: AbortSignal): Promise<AgentPolicy> {
  const { user, project } = await readBoth(root);
  const hooks = root !== null && project.hooks.length > 0 && (await projectHooksApproved(root, project.hooks, signal)) ? project.hooks : [];
  return { root, settings: mergeAgentSettings(user, { ...project, hooks }) };
}

/* ── Running a hook ───────────────────────────────────────────────────────── */

/** Run one hook command in the project folder, with `input` as JSON on stdin. */
export function runAgentHook(hook: AgentHook, input: unknown, root: string | null, signal: AbortSignal): Promise<HookRun> {
  return new Promise((done) => {
    const cwd = root ?? homedir();
    const { file, args, verbatim } = shellFor(hook.command);
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        // CLAUDE_PROJECT_DIR too, so a hook script written for Claude Code finds the project.
        env: { ...process.env, ADCODE_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd, ADCODE_HOOK_EVENT: hook.event },
      });
    } catch (error) {
      done({ exitCode: null, stdout: "", stderr: error instanceof Error ? error.message : "could not start", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, hook.timeoutMs);
    const abort = (): void => killTree(child);
    signal.addEventListener("abort", abort, { once: true });
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      done({ exitCode: timedOut ? null : exitCode, stdout, stderr, timedOut });
    };
    child.stdout?.on("data", (chunk: Buffer) => { if (stdout.length < MAX_HOOK_OUTPUT) stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < MAX_HOOK_OUTPUT) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      stderr += error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    // A hook that never reads its stdin closes the pipe early; that is not a failure.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify(input));
  });
}

/* ── For the agents ───────────────────────────────────────────────────────── */

export interface AgentRulesOptions {
  /** The project the agent works in. */
  readonly root: () => string | null;
  /** Which agent is calling, for hook scripts: "chat", "helper", "team". */
  readonly agent: string;
  readonly sessionId?: () => string | null;
}

/**
 * One rules question on screen at a time. The dialog answers an unanswered question no when a
 * new one arrives, and helpers working side by side can reach ask rules together.
 */
let questions: Promise<unknown> = Promise.resolve();
function askInTurn(question: PolicyQuestion, root: string | null, signal: AbortSignal): Promise<boolean> {
  const rule = root === null ? null : question.suggestedRule;
  const answer = questions.then(async () => {
    if (signal.aborted) return false;
    const choice = await chooseInWindow(BrowserWindow.getFocusedWindow(), {
      title: question.title,
      body: rule === null ? question.body : `${question.body}\n\nAlways allow adds "${rule}" to this project's .adcode/settings.json.`,
      confirmLabel: "Allow once",
      cancelLabel: "Don't allow",
      ...(rule === null ? {} : { alternateLabel: "Always allow" }),
    }, signal);
    if (choice === "alternate" && rule !== null && root !== null) {
      await rememberAllowRule(root, rule).catch((error: unknown) => recordDebug("warn", "ai:rules", `Could not save the allow rule: ${error instanceof Error ? error.message : String(error)}`));
    }
    return choice !== "cancel";
  });
  questions = answer.catch(() => undefined);
  return answer;
}

/**
 * "Always allow": the rule joins the project's `permissions.allow` list, with the file's
 * comments kept. A file whose list cannot be found is rewritten from its parsed form.
 */
export async function rememberAllowRule(root: string, rule: string): Promise<void> {
  const path = projectSettingsPath(root);
  const before = await readFile(path, "utf8").catch(() => "");
  let next = addAllowRule(before, rule);
  if (next === null) {
    const parsed: unknown = JSON.parse(stripJsonComments(before));
    const object = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const permissions = typeof object["permissions"] === "object" && object["permissions"] !== null ? object["permissions"] as Record<string, unknown> : {};
    const allow = Array.isArray(permissions["allow"]) ? permissions["allow"] : [];
    next = `${JSON.stringify({ ...object, permissions: { ...permissions, allow: [rule, ...allow] } }, null, 2)}\n`;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next, "utf8");
  recordDebug("info", "ai:rules", `Always allowed in this project: ${rule}`);
}

/** Check every call an agent makes against the rules and hooks. Wrap each agent's runner once. */
export function withAgentRules(runner: ToolRunner, options: AgentRulesOptions): ToolRunner {
  return withToolPolicy(runner, {
    policy: (signal) => agentPolicy(options.root(), signal),
    ask: (question, signal) => askInTurn(question, options.root(), signal),
    runHook: (hook, input, signal) => runAgentHook(hook, input, options.root(), signal),
    hookFields: () => ({ session_id: options.sessionId?.() ?? null, agent: options.agent }),
    // External MCP calls ask in their own dialog when the person wants that; an ask rule does
    // not ask twice, and with the dialog off an ask rule still asks.
    asksItself: (name) => name === "call_mcp" && askBeforeConnectorTools(),
    onNote: (text) => recordDebug("warn", "ai:hooks", text),
  });
}

/** What sessionStart hooks print, for the chat's context. Run once per conversation. */
export async function agentSessionStart(root: string | null, sessionId: string, signal: AbortSignal): Promise<string | null> {
  const { settings } = await agentPolicy(root, signal);
  if (!settings.hooks.some((hook) => hook.event === "sessionStart")) return null;
  const outcome = await runEventHooks("sessionStart", settings.hooks, { session_id: sessionId, cwd: root, source: "startup" }, (hook, input, hookSignal) => runAgentHook(hook, input, root, hookSignal), signal);
  for (const failure of outcome.failures) recordDebug("warn", "ai:hooks", failure);
  return outcome.output.length === 0 ? null : `Output of this project's sessionStart hooks:\n${outcome.output}`;
}

/**
 * userPromptSubmit hooks, before a message reaches the model: a reason to stop it (exit code 2,
 * or `decision: "block"`), and what they printed for the model's context.
 */
export async function agentPromptHooks(root: string | null, input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal): Promise<{ readonly blocked: string | null; readonly context: string | null }> {
  const { settings } = await agentPolicy(root, signal);
  if (!settings.hooks.some((hook) => hook.event === "userPromptSubmit")) return { blocked: null, context: null };
  const outcome = await runEventHooks("userPromptSubmit", settings.hooks, { session_id: input.sessionId, cwd: root, prompt: input.prompt }, (hook, hookInput, hookSignal) => runAgentHook(hook, hookInput, root, hookSignal), signal);
  for (const failure of outcome.failures) recordDebug("warn", "ai:hooks", failure);
  return { blocked: outcome.blocked, context: outcome.output.length === 0 ? null : outcome.output };
}

/** A stop hook's reason the agent is not done yet (exit code 2), or null to let it finish. */
export async function agentStopHooks(root: string | null, input: { readonly sessionId: string; readonly again: boolean; readonly lastMessage: string }, signal: AbortSignal): Promise<string | null> {
  const { settings } = await agentPolicy(root, signal);
  if (!settings.hooks.some((hook) => hook.event === "stop")) return null;
  const outcome = await runEventHooks(
    "stop",
    settings.hooks,
    { session_id: input.sessionId, cwd: root, stop_hook_active: input.again, last_assistant_message: input.lastMessage.slice(-4000) },
    (hook, hookInput, hookSignal) => runAgentHook(hook, hookInput, root, hookSignal),
    signal,
  );
  for (const failure of outcome.failures) recordDebug("warn", "ai:hooks", failure);
  return outcome.blocked;
}

/** The rules in a line for the agent's context, or null when there are none. */
export async function agentRulesContext(root: string | null): Promise<string | null> {
  const { user, project } = await readBoth(root);
  return describeRules([...user.rules, ...project.rules]);
}

const STARTER = `{
  // Rules for ADCode's AI agents. Help: search "agent rules" in ADCode.
  //
  // A rule is a tool name, optionally with a pattern in parentheses:
  //   "run_command(npm test*)"  "edit_file(src/**)"  "delete_file(*)"  "fetch_url(domain:example.com)"
  // deny always wins. Between ask and allow, the more specific rule decides.
  // A call no rule mentions runs, as it always has.
  //
  // Example: "deny": ["run_command(git push*)", "edit_file(.env*)"], "ask": ["delete_file(*)"]
  "permissions": {
    "allow": [],
    "ask": [],
    "deny": []
  },

  // Shell commands run at points in the agent's work. Each gets the call as JSON on stdin;
  // exit code 2 blocks the call (or, for stop, sends the agent back to work) with what the
  // command printed to stderr as the reason. A hook may print Claude Code's JSON instead, e.g.
  // {"hookSpecificOutput":{"permissionDecision":"allow"}} to skip the question for a call.
  // userPromptSubmit runs before each message: exit 2 stops it, and what it prints is context.
  //
  // Example: "preToolUse": [{ "matcher": "run_command", "command": "node .adcode/check.mjs" }],
  //          "stop": [{ "command": "npm test --silent" }]
  "hooks": {
    "preToolUse": [],
    "postToolUse": [],
    "sessionStart": [],
    "userPromptSubmit": [],
    "stop": []
  }
}
`;

const AGENT_FILE_STARTER = `---
name: test-writer
description: Writes and runs unit tests for code that just changed. Use after a feature or a fix.
# Which tools it may use - ADCode's names or Claude Code's (Read, Grep, Glob, Edit, Write, Bash).
# Leave the line out for every tool.
tools: Read, Grep, Glob, Edit, Bash
# build: it takes coding helper work by default. explore: research. Leave out for neither.
# helper-for: build
---

You write focused unit tests for the code the lead agent names.

1. Read the changed files and the tests next to them, and follow their style.
2. Add tests for the new behaviour and its edge cases. Do not change the code under test.
3. Run the tests. Report what you added, and anything that fails, with the error.
`;

/** A new agent file in the project's .adcode/agents, from a starter; the first free name. */
async function newAgentFile(root: string): Promise<string> {
  const folder = join(root, ".adcode", "agents");
  await mkdir(folder, { recursive: true });
  for (let index = 1; index < 100; index++) {
    const name = index === 1 ? "test-writer.md" : `agent-${index}.md`;
    const path = join(folder, name);
    const text = index === 1 ? AGENT_FILE_STARTER : AGENT_FILE_STARTER.replace("name: test-writer", `name: agent-${index}`);
    try {
      await writeFile(path, text, { encoding: "utf8", flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("There are already 99 agent files in .adcode/agents.");
}

/** The settings file, created with a commented starter when it does not exist yet - or a new agent file. */
export async function openAgentSettings(scope: unknown, root: string | null): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string }> {
  if (scope === "agentFile") {
    if (root === null) return { ok: false, message: "Open a project folder first: its agents live in .adcode/agents inside it." };
    try {
      return { ok: true, path: await newAgentFile(root) };
    } catch (error) {
      return { ok: false, message: `Could not create an agent file: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }
  if (scope !== "project" && scope !== "user") return { ok: false, message: "Choose the project's rules or your own." };
  if (scope === "project" && root === null) return { ok: false, message: "Open a project folder first: its rules live in .adcode/settings.json inside it." };
  const path = scope === "project" ? projectSettingsPath(root!) : userSettingsPath();
  try {
    await stat(path);
  } catch {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, STARTER, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
        return { ok: false, message: `Could not create ${path}: ${error instanceof Error ? error.message : "unknown error"}` };
      }
    }
  }
  return { ok: true, path };
}
