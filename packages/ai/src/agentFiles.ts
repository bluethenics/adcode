/**
 * Task agents written as files: one Markdown file per helper, the way Claude Code keeps its
 * subagents - so a team's `.claude/agents/` folder works in ADCode unchanged, and an ADCode
 * project can keep its own in `.adcode/agents/`.
 *
 *   ---
 *   name: test-writer
 *   description: Writes and runs unit tests for code that just changed.
 *   tools: Read, Grep, Glob, Edit, Bash
 *   helper-for: build
 *   ---
 *   You write focused unit tests ...
 *
 * The body is the agent's standing instructions. `tools` narrows what it may use (Claude Code's
 * tool names are read as ADCode's own; absent means every tool). `helper-for: build | explore`
 * makes it the default helper for that kind of task.
 *
 * Where it runs: a file in the person's own folder (`~/.adcode/agents`, `~/.claude/agents`) may
 * name a model as `provider/model`. A project's file never chooses a model - it runs on the
 * chat's own - because a repository someone cloned must not be able to send work, and the bill,
 * to a provider the person did not pick. Claude Code's aliases (sonnet, opus, inherit) mean
 * "the chat's model" here.
 *
 * Pure: the host reads the folders and passes the text in.
 */
import { parseHelperFor, type HelperDuty, type TaskAgent } from "./taskAgents.ts";
import { parseToolAccess, READ_ONLY_TOOL_NAMES, type ToolAccess } from "./toolAccess.ts";

/** Where agent files live, in the order they are read; the first agent with an id wins. */
export const AGENT_FOLDERS = [".adcode/agents", ".claude/agents"] as const;
export type AgentFileScope = "project" | "user";

/** Claude Code's tool names, as the ADCode tools that do the same job. */
const CLAUDE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  read: ["read_file"],
  grep: ["search"],
  glob: ["glob_files"],
  ls: ["list_files"],
  edit: ["edit_file"],
  multiedit: ["edit_file"],
  write: ["propose_edit"],
  notebookedit: ["edit_file"],
  bash: ["run_command", "command_output", "stop_command"],
  bashoutput: ["command_output"],
  killshell: ["stop_command"],
  webfetch: ["fetch_url"],
  todowrite: ["update_plan"],
};

const MAX_INSTRUCTIONS = 8_000;
const MAX_DESCRIPTION = 300;
const AGENT_ID = /^[a-z][a-z0-9-]{2,47}$/;
/** Model aliases that mean "whatever the chat runs on". */
const SAME_MODEL = /^(inherit|default|sonnet|opus|haiku|fable)$/i;

export interface AgentFile extends TaskAgent {
  readonly description?: string;
  /** Where it was read from, for messages: ".claude/agents/test-writer.md". */
  readonly origin: string;
}

/** The front matter's `key: value` lines and the body after it, or null without front matter. */
export function splitFrontMatter(text: string): { readonly fields: Readonly<Record<string, string>>; readonly body: string } | null {
  const normalised = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalised);
  if (match === null) return null;
  const fields: Record<string, string> = {};
  let last: string | null = null;
  for (const line of match[1]!.split("\n")) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (pair !== null) {
      last = pair[1]!.toLowerCase();
      fields[last] = pair[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    } else if (last !== null && /^\s+-\s+/.test(line)) {
      // A YAML list under the key: `tools:` then `  - Read`.
      const item = line.replace(/^\s+-\s+/, "").trim();
      fields[last] = fields[last] === "" ? item : `${fields[last]}, ${item}`;
    }
  }
  return { fields, body: normalised.slice(match[0].length).trim() };
}

/** `Read, Grep, edit_file` as ADCode's tool names; null when it names nothing ADCode has. */
export function toolsFromList(written: string): ToolAccess | null {
  const names = written.replace(/^\[|\]$/g, "").split(/[,\s]+/).map((name) => name.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  if (names.length === 0 || names.includes("*")) return "all";
  const tools = new Set<string>();
  for (const name of names) {
    // `Bash(npm test:*)` narrows Claude Code's own permission; here it is the tool.
    const bare = name.replace(/\(.*$/, "");
    const mapped = CLAUDE_TOOLS[bare.toLowerCase()];
    if (mapped !== undefined) mapped.forEach((tool) => tools.add(tool));
    else if (/^[a-z][a-z0-9_]*$/.test(bare)) tools.add(bare);
  }
  if (tools.size === 0) return null;
  const list = [...tools];
  if (list.every((tool) => READ_ONLY_TOOL_NAMES.includes(tool))) return list;
  return parseToolAccess(list);
}

/** An id from a written name: "Test Writer" → "test-writer". */
function agentId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** One agent file, or why it cannot be used. */
export function parseAgentFile(origin: string, text: string, scope: AgentFileScope): AgentFile | string {
  const split = splitFrontMatter(text);
  if (split === null) return `${origin} has no front matter (a --- block with name and description at the top).`;
  const { fields, body } = split;
  const fileName = origin.split(/[\\/]/).pop()?.replace(/\.md$/i, "") ?? "";
  const name = (fields["name"] ?? "").trim() || fileName;
  const id = agentId(name);
  if (!AGENT_ID.test(id)) return `${origin}: "${name}" cannot be an agent's name - use letters, digits and dashes, at least three.`;
  if (body.length === 0) return `${origin} has no instructions below its front matter.`;
  const description = (fields["description"] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
  let toolAccess: ToolAccess | undefined;
  if (fields["tools"] !== undefined && fields["tools"].trim() !== "") {
    const parsed = toolsFromList(fields["tools"]);
    if (parsed === null) return `${origin}: none of its tools (${fields["tools"]}) is a tool ADCode has.`;
    toolAccess = parsed;
  }
  const model = (fields["model"] ?? "").trim();
  const provider = (fields["provider"] ?? "").trim();
  // provider/model, or provider + model on separate lines - from the person's own folder only.
  const slash = /^([a-z0-9][\w.-]*)\/(.+)$/i.exec(model);
  const own = scope === "user" && !SAME_MODEL.test(model) && model !== ""
    ? provider !== "" ? { provider, model } : slash !== null ? { provider: slash[1]!, model: slash[2]! } : null
    : null;
  const helperFor: readonly HelperDuty[] = parseHelperFor((fields["helper-for"] ?? fields["helperfor"] ?? "").split(/[,\s]+/)) ?? [];
  return {
    id,
    name,
    instructions: body.length > MAX_INSTRUCTIONS ? `${body.slice(0, MAX_INSTRUCTIONS)}\n[instructions cut at ${MAX_INSTRUCTIONS} characters]` : body,
    provider: own?.provider ?? "",
    model: own?.model ?? "",
    useCurrentModel: own === null,
    ...(toolAccess === undefined ? {} : { toolAccess }),
    helperFor,
    ...(description === "" ? {} : { description }),
    origin,
  };
}

/** Every readable agent from the files given, the first of each id kept, and what was skipped. */
export function readAgentFiles(files: readonly { readonly origin: string; readonly text: string; readonly scope: AgentFileScope }[]): { readonly agents: AgentFile[]; readonly problems: string[] } {
  const agents: AgentFile[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const parsed = parseAgentFile(file.origin, file.text, file.scope);
    if (typeof parsed === "string") problems.push(parsed);
    else if (agents.some((agent) => agent.id === parsed.id)) problems.push(`${file.origin}: an agent called ${parsed.id} is already defined; this one is skipped.`);
    else agents.push(parsed);
  }
  return { agents, problems };
}

/** Saved agents first (the person's own choice wins an id), then file agents not already named. */
export function withFileAgents(saved: readonly TaskAgent[], files: readonly AgentFile[]): TaskAgent[] {
  return [...saved, ...files.filter((file) => !saved.some((agent) => agent.id === file.id))];
}
