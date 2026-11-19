/**
 * Tool rules and hooks: what a project, or the person, lets ADCode's agents do.
 *
 * ADCode's default is to act: edits apply with a per-turn Undo and only external MCP tools
 * ask first. That is right for somebody watching, and wrong for a run nobody watches - so a
 * project can say, in `.adcode/settings.json` (and a person in `~/.adcode/settings.json`):
 *
 *   { "permissions": { "allow": [...], "ask": [...], "deny": [...] },
 *     "hooks": { "preToolUse": [...], "postToolUse": [...], "sessionStart": [...], "userPromptSubmit": [...], "stop": [...] } }
 *
 * A rule is a tool name, optionally with a pattern: `run_command(npm test*)`,
 * `edit_file(src/**)`, `delete_file(*)`, `call_mcp(github/*)`. Every call is checked before
 * it runs. Deny always wins. Between ask and allow, the more specific rule decides, so
 * `ask: ["run_command"]` with `allow: ["run_command(npm test*)"]` asks before every command
 * but the tests. No rule means today's behaviour: the call runs.
 *
 * A hook is a shell command. It gets the call as JSON on stdin (the field names Claude Code
 * uses, so its hook scripts carry over); exit code 2 blocks, with its stderr as the reason.
 * A hook may instead print Claude Code's JSON answer (`parseHookOutput`): a preToolUse hook
 * can allow a call without the question, deny it, insist on asking, or rewrite its input.
 *
 * Plain TypeScript: no Electron, no file system, no processes. The host reads the files,
 * asks the person and runs the commands; everything that decides is here, under test.
 */
import type { ToolCallBlock, ToolRunner, ToolRunResult } from "./types.ts";

export type RuleDecision = "allow" | "ask" | "deny";
/** Whose file a rule came from. A project's file cannot loosen what the person's own file asks. */
export type RuleSource = "user" | "project";
export type HookEvent = "preToolUse" | "postToolUse" | "sessionStart" | "userPromptSubmit" | "stop";

export const PROJECT_AGENT_SETTINGS = ".adcode/settings.json";
export const USER_AGENT_SETTINGS = "~/.adcode/settings.json";
export const HOOK_EVENTS: readonly HookEvent[] = ["preToolUse", "postToolUse", "sessionStart", "userPromptSubmit", "stop"];
/** Claude Code spells the events in PascalCase; both spellings are read. */
const HOOK_EVENT_NAMES: Readonly<Record<HookEvent, string>> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  sessionStart: "SessionStart",
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
};
export const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;
const MAX_HOOK_TIMEOUT_SECONDS = 600;
/** What a hook's words may add to a tool result or the context. */
const MAX_HOOK_TEXT = 4000;
/** How much of a tool's output a postToolUse hook is handed. */
const MAX_HOOK_RESPONSE = 20_000;

export interface ToolRule {
  /** As written in the file, for messages. */
  readonly text: string;
  readonly decision: RuleDecision;
  readonly source: RuleSource;
  readonly tool: RegExp;
  /** The part in parentheses, or null for every call of the tool. */
  readonly pattern: string | null;
  /** Higher is narrower: a bare `*` < a tool-name wildcard < a tool name < a pattern, by its literal characters. */
  readonly specificity: number;
}

export interface AgentHook {
  readonly event: HookEvent;
  /** Which tool calls it runs for; null for all of them (and always for sessionStart and stop). */
  readonly matchers: readonly ToolRule[] | null;
  readonly command: string;
  readonly timeoutMs: number;
  readonly source: RuleSource;
}

export interface AgentSettings {
  readonly rules: readonly ToolRule[];
  readonly hooks: readonly AgentHook[];
  /** Entries that were skipped, and why - shown in the debug log, never fatal. */
  readonly problems: readonly string[];
  /** Set when the file could not be read at all: its rules are not in force, so changes ask first. */
  readonly unreadable: string | null;
}

export const EMPTY_AGENT_SETTINGS: AgentSettings = { rules: [], hooks: [], problems: [], unreadable: null };

export const settingsFileName = (source: RuleSource): string => (source === "project" ? PROJECT_AGENT_SETTINGS : USER_AGENT_SETTINGS);

/* ── Patterns ─────────────────────────────────────────────────────────────── */

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** A wildcard where `*` is any run of characters, whole-string and case-insensitive. */
function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "is");
}

/** A path glob: `*` within one folder, `**` across folders, `?` one character, `{a,b}` either. */
function globRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length;) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 3;
      } else {
        source += ".*";
        i += 2;
      }
    } else if (char === "*") {
      source += "[^/]*";
      i += 1;
    } else if (char === "?") {
      source += "[^/]";
      i += 1;
    } else if (char === "{" && glob.indexOf("}", i) !== -1) {
      const end = glob.indexOf("}", i);
      source += `(?:${glob.slice(i + 1, end).split(",").map((part) => escapeRegExp(part.trim())).join("|")})`;
      i = end + 1;
    } else {
      source += escapeRegExp(char);
      i += 1;
    }
  }
  return new RegExp(`^${source}$`, "i");
}

/**
 * Whether a path rule covers a workspace-relative path, the way .gitignore reads a line.
 *
 * A pattern with no slash names a file or folder at any depth (`*.env`, `node_modules`); one
 * with a slash is from the project root (`src/**`). A rule on a folder covers everything in
 * it, so `deny: ["edit_file(dist)"]` protects `dist/app.js` too.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const trimmed = pattern.trim().replaceAll("\\", "/");
  if (trimmed === "*" || trimmed === "**" || trimmed === "**/*") return true;
  const anchored = trimmed.replace(/\/+$/, "").includes("/");
  const glob = trimmed.replace(/^(?:\.\/|\/)+/, "").replace(/\/+$/, "");
  if (glob.length === 0) return path.length === 0;
  const pattern_ = globRegExp(glob);
  const segments = path.split("/");
  for (let end = segments.length; end >= 1; end--) {
    if (anchored ? pattern_.test(segments.slice(0, end).join("/")) : pattern_.test(segments[end - 1]!)) return true;
  }
  return false;
}

/** A path as rules see it: workspace-relative, forward slashes, no `./`. */
export function workspacePath(input: unknown, root: string | null): string {
  if (typeof input !== "string") return "";
  let path = input.trim().replaceAll("\\", "/");
  if (root !== null && root.length > 0) {
    const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
    const lowered = path.toLowerCase();
    if (lowered === base.toLowerCase()) path = "";
    else if (lowered.startsWith(`${base.toLowerCase()}/`)) path = path.slice(base.length + 1);
  }
  return path.split("/").filter((part) => part !== "" && part !== ".").join("/");
}

/**
 * The commands in a command line: `npm test && git push` is two, each checked on its own,
 * so a deny rule is not stepped around by putting something harmless first. Quotes are
 * respected; redirections such as `2>&1` are not separators.
 */
export function commandParts(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const next = command[i + 1];
    const previous = command[i - 1];
    const separator =
      char === ";" || char === "\n" || char === "\r" ||
      (char === "|") ||
      (char === "&" && previous !== ">" && previous !== "<" && next !== ">");
    if (!separator) {
      current += char;
      continue;
    }
    if ((char === "&" || char === "|") && next === char) i += 1;
    parts.push(current);
    current = "";
  }
  parts.push(current);
  return parts.map((part) => part.trim().replace(/^\(+|\)+$/g, "").trim().replace(/\s+/g, " ")).filter((part) => part.length > 0);
}

type TargetKind = "command" | "path" | "url" | "name";

const PATH_TOOLS = new Set(["read_file", "edit_file", "propose_edit", "delete_file", "get_outline", "list_files", "search", "glob_files"]);
const PAGE_TOOLS = new Set(["fetch_url", "view_page", "audit_page", "open_preview"]);
/** Tools that change something. When a settings file cannot be read, these ask first. */
const CHANGING_TOOLS = new Set(["run_command", "edit_file", "propose_edit", "delete_file", "move_file", "memory_write", "call_mcp", "adcode_action", "adcode_connectors"]);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** What a rule's pattern is matched against for this call, or null when the tool has no target. */
export function callTargets(call: ToolCallBlock, root: string | null): { readonly kind: TargetKind; readonly values: readonly string[] } | null {
  const input = typeof call.input === "object" && call.input !== null ? call.input : {};
  if (call.name === "run_command") {
    const whole = text(input["command"]).trim().replace(/\s+/g, " ");
    const parts = commandParts(text(input["command"]));
    return { kind: "command", values: parts.length > 1 ? [whole, ...parts] : [whole] };
  }
  if (PATH_TOOLS.has(call.name)) return { kind: "path", values: [workspacePath(input["path"], root)] };
  if (call.name === "move_file") return { kind: "path", values: [workspacePath(input["from"], root), workspacePath(input["to"], root)] };
  if (PAGE_TOOLS.has(call.name)) return { kind: "url", values: [text(input["url"]) || text(input["path"])] };
  if (call.name === "call_mcp") return { kind: "name", values: [`${text(input["server"])}/${text(input["tool"])}`] };
  if (call.name === "adcode_action") return { kind: "name", values: [text(input["command"]) || text(input["setting"])] };
  if (call.name === "adcode_connectors") return { kind: "name", values: [`${text(input["action"])}/${text(input["id"]) || text(input["preset"])}`] };
  if (call.name === "load_skill" || call.name === "load_builtin_skill") return { kind: "name", values: [text(input["id"]) || text(input["name"])] };
  return null;
}

function targetMatches(kind: TargetKind, pattern: string, value: string): boolean {
  if (kind === "path") return pathMatches(pattern, value);
  if (kind === "url" && /^domain:/i.test(pattern)) {
    const domain = pattern.slice("domain:".length).trim().toLowerCase();
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }
  return wildcard(kind === "command" ? pattern.trim().replace(/\s+/g, " ") : pattern.trim()).test(value);
}

/* ── Rules ────────────────────────────────────────────────────────────────── */

const RULE = /^\s*([A-Za-z0-9_*.:-]+)\s*(?:\(([\s\S]*)\))?\s*$/;

/** One rule as written, or why it cannot be read. */
export function parseRule(written: unknown, decision: RuleDecision, source: RuleSource): ToolRule | string {
  if (typeof written !== "string" || written.trim().length === 0) return `${JSON.stringify(written)} is not a rule: write a tool name, such as "run_command" or "run_command(npm test*)".`;
  const match = RULE.exec(written);
  if (match === null) return `"${written}" is not a rule: write a tool name, optionally with a pattern in parentheses, such as "edit_file(src/**)".`;
  const name = match[1]!;
  const pattern = match[2] === undefined || match[2].trim().length === 0 ? null : match[2].trim();
  const literal = pattern === null ? 0 : pattern.replace(/^domain:/i, "").replace(/[*?{}]/g, "").length;
  return {
    text: written.trim(),
    decision,
    source,
    tool: wildcard(name),
    pattern,
    specificity: pattern !== null ? 1 + literal : name === "*" ? -2 : name.includes("*") ? -1 : 0,
  };
}

export function ruleMatches(rule: ToolRule, call: ToolCallBlock, kind: TargetKind | null, value: string | null): boolean {
  if (!rule.tool.test(call.name)) return false;
  if (rule.pattern === null) return true;
  return kind !== null && value !== null && targetMatches(kind, rule.pattern, value);
}

export interface RuleVerdict {
  readonly decision: RuleDecision;
  /** The rule that decided, or null when none matched (the default: allow). */
  readonly rule: ToolRule | null;
  /** The command or path the rule matched. */
  readonly target: string | null;
}

const RANK: Readonly<Record<RuleDecision, number>> = { allow: 0, ask: 1, deny: 2 };

function decideTarget(rules: readonly ToolRule[], call: ToolCallBlock, kind: TargetKind | null, value: string | null): RuleVerdict {
  const matched = rules.filter((rule) => ruleMatches(rule, call, kind, value));
  const deny = matched.find((rule) => rule.decision === "deny");
  if (deny !== undefined) return { decision: "deny", rule: deny, target: value };
  const allows = matched.filter((rule) => rule.decision === "allow");
  // An ask stands unless a narrower allow lifts it - and a project's allow never lifts the
  // person's own ask: a cloned repository cannot switch off what you asked to be asked.
  const standing = matched.find((rule) =>
    rule.decision === "ask" &&
    !allows.some((allow) => allow.specificity > rule.specificity && (allow.source === "user" || rule.source === "project")));
  if (standing !== undefined) return { decision: "ask", rule: standing, target: value };
  const allow = [...allows].sort((a, b) => b.specificity - a.specificity)[0];
  return { decision: "allow", rule: allow ?? null, target: value };
}

/**
 * What the rules say about one call. A call with several targets - a chained command, a
 * move's two paths - gets the strictest answer any of them gets.
 */
export function decideToolCall(rules: readonly ToolRule[], call: ToolCallBlock, root: string | null): RuleVerdict {
  const targets = callTargets(call, root);
  const values: readonly (string | null)[] = targets === null || targets.values.length === 0 ? [null] : targets.values;
  let verdict: RuleVerdict = { decision: "allow", rule: null, target: null };
  for (const value of values) {
    const next = decideTarget(rules, call, targets?.kind ?? null, value);
    if (RANK[next.decision] > RANK[verdict.decision] || (verdict.rule === null && next.rule !== null && next.decision === verdict.decision)) verdict = next;
  }
  return verdict;
}

/**
 * The agent's own rules file is not the agent's to rewrite. Changing it asks first, so a
 * deny rule an unattended run depends on cannot be edited away by the run it constrains.
 */
export const SELF_PROTECTION_RULES: readonly ToolRule[] = ["edit_file", "propose_edit", "delete_file", "move_file"]
  .map((tool) => parseRule(`${tool}(${PROJECT_AGENT_SETTINGS})`, "ask", "user") as ToolRule);

/* ── The settings file ────────────────────────────────────────────────────── */

/** JSON with `//` and `/* *\/` comments and trailing commas, as VS Code's settings allow. */
export function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (inString) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
      } else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
    } else if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
    } else out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseHookEntries(event: HookEvent, raw: unknown, source: RuleSource, problems: string[]): AgentHook[] {
  if (!Array.isArray(raw)) {
    problems.push(`hooks.${event} should be a list of { "command": "..." } entries.`);
    return [];
  }
  const hooks: AgentHook[] = [];
  for (const [index, entry] of raw.entries()) {
    const where = `hooks.${event}[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} is not an object.`);
      continue;
    }
    // A matcher is one rule-shaped string or a list of them; missing or "*" is every tool.
    let matchers: ToolRule[] | null = null;
    const matcher = entry["matcher"];
    if (matcher !== undefined && matcher !== "" && matcher !== "*" && (event === "preToolUse" || event === "postToolUse")) {
      const list = Array.isArray(matcher) ? matcher : [matcher];
      const parsed = list.map((item) => parseRule(item, "allow", source));
      const bad = parsed.find((item): item is string => typeof item === "string");
      if (bad !== undefined) {
        problems.push(`${where}.matcher: ${bad}`);
        continue;
      }
      matchers = parsed as ToolRule[];
    }
    // Claude Code nests the commands: { matcher, hooks: [{ type: "command", command }] }.
    const commands = Array.isArray(entry["hooks"]) ? entry["hooks"] : [entry];
    for (const item of commands) {
      const command = isRecord(item) && typeof item["command"] === "string" ? item["command"].trim() : "";
      if (command.length === 0) {
        problems.push(`${where} needs a "command" to run.`);
        continue;
      }
      if (isRecord(item) && item["type"] !== undefined && item["type"] !== "command") {
        problems.push(`${where}: only "command" hooks are supported.`);
        continue;
      }
      const seconds = isRecord(item) && typeof item["timeout"] === "number" && Number.isFinite(item["timeout"]) && item["timeout"] > 0
        ? Math.min(item["timeout"], MAX_HOOK_TIMEOUT_SECONDS)
        : DEFAULT_HOOK_TIMEOUT_SECONDS;
      hooks.push({ event, matchers, command, timeoutMs: Math.round(seconds * 1000), source });
    }
  }
  return hooks;
}

/** Read one settings file's text. Bad entries are skipped and listed; the rest still apply. */
export function parseAgentSettings(source: string, from: RuleSource): AgentSettings {
  if (source.trim().length === 0) return EMPTY_AGENT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(source));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "it is not valid JSON";
    return { ...EMPTY_AGENT_SETTINGS, unreadable: `${settingsFileName(from)} is not valid JSON (${reason})` };
  }
  if (!isRecord(parsed)) return { ...EMPTY_AGENT_SETTINGS, unreadable: `${settingsFileName(from)} should hold one JSON object` };
  const problems: string[] = [];
  const rules: ToolRule[] = [];
  const permissions = parsed["permissions"];
  if (permissions !== undefined && !isRecord(permissions)) problems.push(`"permissions" should be an object with allow, ask and deny lists.`);
  if (isRecord(permissions)) {
    for (const decision of ["allow", "ask", "deny"] as const) {
      const list = permissions[decision];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        problems.push(`permissions.${decision} should be a list of rules.`);
        continue;
      }
      for (const written of list) {
        const rule = parseRule(written, decision, from);
        if (typeof rule === "string") problems.push(`permissions.${decision}: ${rule}`);
        else rules.push(rule);
      }
    }
  }
  const hooks: AgentHook[] = [];
  const hookTable = parsed["hooks"];
  if (hookTable !== undefined && !isRecord(hookTable)) problems.push(`"hooks" should be an object keyed by preToolUse, postToolUse, sessionStart, userPromptSubmit or stop.`);
  if (isRecord(hookTable)) {
    for (const [key, raw] of Object.entries(hookTable)) {
      const event = HOOK_EVENTS.find((name) => name === key || HOOK_EVENT_NAMES[name] === key);
      if (event === undefined) {
        problems.push(`hooks.${key} is not a hook event; use preToolUse, postToolUse, sessionStart, userPromptSubmit or stop.`);
        continue;
      }
      hooks.push(...parseHookEntries(event, raw, from, problems));
    }
  }
  return { rules, hooks, problems, unreadable: null };
}

/** The person's file and the project's, as one set. */
export function mergeAgentSettings(...all: readonly AgentSettings[]): AgentSettings {
  const unreadable = all.map((settings) => settings.unreadable).filter((reason): reason is string => reason !== null);
  return {
    rules: all.flatMap((settings) => settings.rules),
    hooks: all.flatMap((settings) => settings.hooks),
    problems: all.flatMap((settings) => settings.problems),
    unreadable: unreadable.length === 0 ? null : unreadable.join("; "),
  };
}

/** A stable fingerprint of a file's hooks, so approving them once lasts until they change. */
export function hooksFingerprint(hooks: readonly AgentHook[]): string {
  return JSON.stringify(hooks.map((hook) => [hook.event, hook.matchers?.map((rule) => rule.text) ?? null, hook.command, hook.timeoutMs]));
}

/** The rules in a line for the agent's context, so it does not spend calls finding them out. */
export function describeRules(rules: readonly ToolRule[]): string | null {
  const written = rules.filter((rule) => !SELF_PROTECTION_RULES.includes(rule));
  if (written.length === 0) return null;
  const list = (decision: RuleDecision): string[] => written.filter((rule) => rule.decision === decision).map((rule) => rule.text);
  const parts = [
    list("deny").length > 0 ? `denied (the call fails): ${list("deny").join(", ")}` : null,
    list("ask").length > 0 ? `ask the user first: ${list("ask").join(", ")}` : null,
    list("allow").length > 0 ? `allowed without asking: ${list("allow").join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  return `Tool rules from .adcode/settings.json - ${parts.join("; ")}. Do not try to work around a denied call; tell the user when the task needs it.`;
}

/* ── Hooks ────────────────────────────────────────────────────────────────── */

export interface HookRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Whether a hook runs for this call. */
export function hookApplies(hook: AgentHook, call: ToolCallBlock, root: string | null): boolean {
  if (hook.matchers === null) return true;
  const targets = callTargets(call, root);
  const values: readonly (string | null)[] = targets === null || targets.values.length === 0 ? [null] : targets.values;
  return hook.matchers.some((rule) => values.some((value) => ruleMatches(rule, call, targets?.kind ?? null, value)));
}

/** What a hook is sent on stdin: Claude Code's field names, so its hook scripts work here. */
export function hookInput(event: HookEvent, fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { hook_event_name: HOOK_EVENT_NAMES[event], ...fields };
}

const clip = (value: string, max = MAX_HOOK_TEXT): string => (value.length > max ? `${value.slice(0, max)}\n[cut at ${max} characters]` : value);
const reasonOf = (run: HookRun): string => clip(run.stderr.trim() || run.stdout.trim() || "it gave no reason");

/**
 * What a hook said in Claude Code's JSON form, when its stdout is one JSON object. Plain text
 * (or nothing) is not an answer: exit codes decide then, as before.
 *
 * - `hookSpecificOutput.permissionDecision`: "allow" | "deny" | "ask" (preToolUse), with
 *   `permissionDecisionReason`, and `updatedInput` to replace the call's input;
 * - `decision`: "block" (or the older "approve") with `reason` - any event;
 * - `hookSpecificOutput.additionalContext`: words for the agent's context.
 */
export interface HookAnswer {
  readonly permission: "allow" | "deny" | "ask" | null;
  readonly block: boolean;
  readonly reason: string | null;
  readonly updatedInput: Record<string, unknown> | null;
  readonly context: string | null;
}

export function parseHookOutput(stdout: string): HookAnswer | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  if (!isRecord(parsed)) return null;
  const specific = isRecord(parsed["hookSpecificOutput"]) ? parsed["hookSpecificOutput"] : {};
  const permissionRaw = specific["permissionDecision"];
  const legacy = parsed["decision"];
  const permission = permissionRaw === "allow" || permissionRaw === "deny" || permissionRaw === "ask"
    ? permissionRaw
    : legacy === "approve" ? "allow" : null;
  const words = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? clip(value.trim()) : null);
  return {
    permission,
    block: legacy === "block" || permission === "deny",
    reason: words(specific["permissionDecisionReason"]) ?? words(parsed["reason"]) ?? words(parsed["stopReason"]),
    updatedInput: isRecord(specific["updatedInput"]) ? specific["updatedInput"] : null,
    context: words(specific["additionalContext"]),
  };
}

export interface EventHooksOutcome {
  /** A stop or userPromptSubmit hook's reason for not going ahead: exit code 2, or `decision: "block"`. */
  readonly blocked: string | null;
  /** What sessionStart and userPromptSubmit hooks printed, for the agent's context. */
  readonly output: string;
  /** Hooks that failed in some other way, for the debug log. Never fatal. */
  readonly failures: readonly string[];
}

/** Run every hook of an event that is not about one tool call: sessionStart, userPromptSubmit, stop. */
export async function runEventHooks(
  event: "sessionStart" | "userPromptSubmit" | "stop",
  hooks: readonly AgentHook[],
  input: Readonly<Record<string, unknown>>,
  runHook: (hook: AgentHook, input: unknown, signal: AbortSignal) => Promise<HookRun>,
  signal: AbortSignal,
): Promise<EventHooksOutcome> {
  const output: string[] = [];
  const failures: string[] = [];
  for (const hook of hooks.filter((candidate) => candidate.event === event)) {
    if (signal.aborted) break;
    const run = await runHook(hook, hookInput(event, input), signal);
    const canBlock = event === "stop" || event === "userPromptSubmit";
    if (run.exitCode === 0) {
      const answer = parseHookOutput(run.stdout);
      if (answer === null) {
        if (run.stdout.trim().length > 0) output.push(run.stdout.trim());
        continue;
      }
      if (answer.block && canBlock) return { blocked: answer.reason ?? "a hook said no", output: clip(output.join("\n")), failures };
      if (answer.context !== null) output.push(answer.context);
    } else if (run.exitCode === 2 && canBlock) {
      return { blocked: reasonOf(run), output: clip(output.join("\n")), failures };
    } else {
      failures.push(`${event} hook "${hook.command}" ${run.timedOut ? "timed out" : `exited ${run.exitCode ?? "without a code"}`}: ${reasonOf(run)}`);
    }
  }
  return { blocked: null, output: clip(output.join("\n")), failures };
}

/* ── The runner ───────────────────────────────────────────────────────────── */

export interface AgentPolicy {
  /** The project folder the agent works in: paths are matched relative to it. */
  readonly root: string | null;
  readonly settings: AgentSettings;
}

export interface PolicyQuestion {
  readonly title: string;
  readonly body: string;
  readonly call: ToolCallBlock;
  /** An allow rule that would let calls like this one through, for "Always allow". */
  readonly suggestedRule: string | null;
}

export interface ToolPolicyDeps {
  /** The rules and hooks in force now, read for every call so an edited file applies at once. */
  readonly policy: (signal: AbortSignal) => Promise<AgentPolicy>;
  /** Ask the person; resolves false when nobody can answer (an unattended run). */
  readonly ask: (question: PolicyQuestion, signal: AbortSignal) => Promise<boolean>;
  /** Run one hook command with `input` as JSON on stdin. */
  readonly runHook: (hook: AgentHook, input: unknown, signal: AbortSignal) => Promise<HookRun>;
  /** More fields for every hook's input: the session, which agent is calling. */
  readonly hookFields?: () => Readonly<Record<string, unknown>>;
  /** Tools that already ask the person themselves (external MCP calls): an ask rule does not ask twice. */
  readonly asksItself?: (name: string) => boolean;
  /** A hook failed without blocking, or a rule was skipped: for the debug log. */
  readonly onNote?: (text: string) => void;
}

const QUESTION_TITLES: Readonly<Record<string, string>> = {
  run_command: "Let the AI run this command?",
  edit_file: "Let the AI change this file?",
  propose_edit: "Let the AI write this file?",
  delete_file: "Let the AI delete this file?",
  move_file: "Let the AI move this file?",
  fetch_url: "Let the AI fetch this address?",
  call_mcp: "Let the AI use this external tool?",
  adcode_action: "Let the AI do this in ADCode?",
  adcode_connectors: "Let the AI change this connector?",
};

/** What the person is asked: the call in their words, and the rule that made it ask. */
export function questionFor(call: ToolCallBlock, verdict: RuleVerdict, root: string | null, unreadable: string | null): PolicyQuestion {
  const targets = callTargets(call, root);
  const shown = targets === null ? call.name : targets.kind === "command" ? targets.values[0] ?? "" : targets.values.join(" → ");
  const because = verdict.rule !== null
    ? `Asked because ${settingsFileName(verdict.rule.source)} says ask: ${verdict.rule.text}`
    : `Asked because ${unreadable ?? "a settings file could not be read"}, so its rules are not in force.`;
  return { title: QUESTION_TITLES[call.name] ?? `Let the AI use ${call.name}?`, body: `${shown}\n\n${because}`, call, suggestedRule: suggestAllowRule(call, root) };
}

/**
 * The narrowest allow rule a person would mean by "always allow this": a command by its first
 * two words (`run_command(npm test*)`), a file by its path, a page by its domain, an external
 * tool by server and name. Null for a call no safe rule describes - a command line that chains
 * several commands, where allowing the first would read as allowing the rest.
 */
export function suggestAllowRule(call: ToolCallBlock, root: string | null): string | null {
  const targets = callTargets(call, root);
  if (targets === null) return /^[A-Za-z0-9_]+$/.test(call.name) ? call.name : null;
  const value = targets.values[0] ?? "";
  if (value === "" || /[()]/.test(value)) return null;
  switch (targets.kind) {
    case "command": {
      if (targets.values.length > 1) return null;
      const words = value.split(" ").filter(Boolean).slice(0, 2);
      return words.length === 0 ? null : `${call.name}(${words.join(" ")}*)`;
    }
    case "url":
      try { return `${call.name}(domain:${new URL(value).hostname})`; } catch { return null; }
    default:
      return targets.values.length > 1 ? null : `${call.name}(${value})`;
  }
}

/**
 * A settings file's text with one more allow rule, comments and layout kept: the rule goes at
 * the front of the existing `"allow": [...]` list. Null when the file has no such list, or more
 * than one: the caller then writes the file afresh from its parsed form.
 */
export function addAllowRule(source: string, rule: string): string | null {
  const quoted = JSON.stringify(rule);
  if (source.trim().length === 0) return `{\n  "permissions": {\n    "allow": [${quoted}]\n  }\n}\n`;
  if (source.includes(quoted)) return source;
  const lists = [...stripJsonComments(source).matchAll(/"allow"\s*:\s*\[/g)];
  const written = [...source.matchAll(/"allow"\s*:\s*\[/g)];
  // The one list the parser reads, and no commented-out copy that could be mistaken for it.
  if (lists.length !== 1 || written.length !== 1) return null;
  const at = written[0]!.index! + written[0]![0].length;
  const empty = /^\s*\]/.test(source.slice(at));
  return `${source.slice(0, at)}${quoted}${empty ? "" : ", "}${source.slice(at)}`;
}


const refuse = (content: string): ToolRunResult => ({ content, isError: true });

/**
 * Check every call against the rules and hooks before it reaches `inner`.
 *
 * Wrap each agent's runner once - the chat's, each helper's, each Team role's - and every
 * call any of them makes is checked exactly once.
 */
export function withToolPolicy(inner: ToolRunner, deps: ToolPolicyDeps): ToolRunner {
  const denied = (rule: ToolRule, target: string | null): ToolRunResult => {
    const what = target === null || target === "" ? "" : ` (${target})`;
    return refuse(
      `Not allowed: the rule deny "${rule.text}" in ${settingsFileName(rule.source)} blocks this call${what}. ` +
        "Do not retry it or work around it with another tool; carry on without it, or tell the user this step needs them.",
    );
  };
  return {
    async run(original, signal) {
      const { root, settings } = await deps.policy(signal);
      const verdictFor = (target: ToolCallBlock): RuleVerdict => {
        const verdict = decideToolCall([...SELF_PROTECTION_RULES, ...settings.rules], target, root);
        // A file that cannot be read has rules nobody can see: whatever changes things asks.
        return verdict.decision === "allow" && verdict.rule === null && settings.unreadable !== null && CHANGING_TOOLS.has(target.name)
          ? { decision: "ask", rule: null, target: null }
          : verdict;
      };
      let call = original;
      let verdict = verdictFor(call);
      if (verdict.decision === "deny" && verdict.rule !== null) return denied(verdict.rule, verdict.target);

      // preToolUse hooks run before anyone is asked, as in Claude Code: a hook can answer the
      // question itself (allow), refuse the call, insist on asking, or rewrite the input.
      const extra = deps.hookFields?.() ?? {};
      let hookAllows = false;
      let hookAsks: string | null = null;
      for (const hook of settings.hooks.filter((candidate) => candidate.event === "preToolUse" && hookApplies(candidate, call, root))) {
        const run = await deps.runHook(hook, hookInput("preToolUse", { ...extra, cwd: root, tool_name: call.name, tool_input: call.input }), signal);
        const where = `a preToolUse hook in ${settingsFileName(hook.source)} ("${hook.command}")`;
        if (run.exitCode === 2) return refuse(`Blocked by ${where}: ${reasonOf(run)}`);
        if (run.exitCode !== 0) {
          deps.onNote?.(`preToolUse hook "${hook.command}" ${run.timedOut ? "timed out" : `exited ${run.exitCode ?? "without a code"}`}; the call went ahead: ${reasonOf(run)}`);
          continue;
        }
        const answer = parseHookOutput(run.stdout);
        if (answer === null) continue;
        if (answer.block) return refuse(`Blocked by ${where}: ${answer.reason ?? "it gave no reason"}`);
        if (answer.updatedInput !== null) call = { ...call, input: answer.updatedInput };
        if (answer.permission === "allow") hookAllows = true;
        if (answer.permission === "ask") hookAsks = answer.reason ?? `${where} asks first`;
      }
      // Rewritten input is checked again: a hook cannot steer a call into a denied target.
      if (call !== original) {
        verdict = verdictFor(call);
        if (verdict.decision === "deny" && verdict.rule !== null) return denied(verdict.rule, verdict.target);
      }

      // A hook's allow answers an ask rule; it never loosens a deny (checked above). A hook that
      // insists on asking asks even where a rule allows, and even for a tool with its own dialog.
      const ruleAsks = verdict.decision === "ask" && !hookAllows && !(deps.asksItself?.(call.name) ?? false);
      if (ruleAsks || hookAsks !== null) {
        const question = questionFor(call, verdict, root, settings.unreadable);
        const shown = question.body.split("\n\n")[0] ?? "";
        const asked = hookAsks === null ? question : { ...question, body: `${shown}\n\nAsked because ${hookAsks}` };
        const allowed = await deps.ask(asked, signal);
        if (!allowed) {
          const rule = hookAsks !== null ? "a preToolUse hook" : verdict.rule === null ? "a settings file it could not read" : `the rule ask "${verdict.rule.text}" in ${settingsFileName(verdict.rule.source)}`;
          return refuse(
            `The user did not allow this call (${rule} asks first, and the answer was no or nobody was there to answer). ` +
              "Do not retry it; carry on without it, or ask the user how they want to proceed.",
          );
        }
      }

      const result = await inner.run(call, signal);

      const post = settings.hooks.filter((candidate) => candidate.event === "postToolUse" && hookApplies(candidate, call, root));
      if (post.length === 0) return result;
      const base = { ...extra, cwd: root, tool_name: call.name, tool_input: call.input };
      const notes: string[] = [];
      for (const hook of post) {
        if (signal.aborted) break;
        const run = await deps.runHook(hook, hookInput("postToolUse", { ...base, tool_response: { content: clip(result.content, MAX_HOOK_RESPONSE), is_error: result.isError } }), signal);
        const where = `A postToolUse hook in ${settingsFileName(hook.source)} ("${hook.command}")`;
        if (run.exitCode === 2) notes.push(`${where} reported a problem with this result: ${reasonOf(run)}`);
        else if (run.exitCode !== 0) deps.onNote?.(`postToolUse hook "${hook.command}" ${run.timedOut ? "timed out" : `exited ${run.exitCode ?? "without a code"}`}: ${reasonOf(run)}`);
        else {
          const answer = parseHookOutput(run.stdout);
          if (answer?.block === true) notes.push(`${where} reported a problem with this result: ${answer.reason ?? "it gave no reason"}`);
          if (answer !== null && answer.context !== null) notes.push(`${where} adds: ${answer.context}`);
        }
      }
      return notes.length === 0 ? result : { ...result, content: `${result.content}\n\n${notes.join("\n")}` };
    },
  };
}
