/**
 * Sub-agents: an agent hands parts of its task to helpers that run at the same time.
 *
 * One `delegate_task` call names up to four tasks. Each gets a fresh agent - its own context,
 * so a long exploration never fills the parent's - on the parent's model or, when the task
 * names a saved task agent (or one is set to take that kind of work), on that agent's own
 * model (`taskAgents.ts`). Each helper gets either the
 * read-only tools (explore) or every tool but this one (build). They run together; the parent
 * gets one tool result with each helper's closing report. Helpers cannot delegate again, so a
 * task can never fan out without bound, and Stop on the parent stops every helper.
 *
 * Their edits go through the parent's own tool runner, so they land in the same undoable turn.
 */
import type { Agent } from "./agent.ts";
import type { AgentEvent, ToolCallBlock, ToolDefinition, ToolRunner, ToolRunResult } from "./types.ts";

export const DELEGATE_TASK_NAME = "delegate_task";
/** Helpers run with nobody watching, so a question would hang: only the parent may ask. */
export const ASK_USER_NAME = "ask_user";
export const MAX_SUBAGENTS = 4;
/** Only the chat makes task agents: a helper never adds helpers. The same name as `CREATE_AGENT_NAME`. */
const CREATE_AGENT_TOOL = "create_agent";
/** What one helper's report may add to the parent's context. */
const REPORT_CHARS = 6000;

export type SubagentMode = "explore" | "build";

export interface SubagentTask {
  readonly title: string;
  readonly instructions: string;
  readonly mode: SubagentMode;
  /** A saved task agent to run it, by id or name; "self" keeps it on the parent's model. Absent: the default for its mode. */
  readonly agent?: string;
}

/** A helper the deps built, with what the report should say about where it ran. */
export interface StartedHelper {
  readonly agent: Agent;
  /** e.g. "deepseek-chat (deepseek) as DeepSeek coder", shown in the report and the status line. */
  readonly ranOn?: string;
  /** The task agent's standing instructions, put in front of the task. */
  readonly instructions?: string;
}

export const DELEGATE_TASK: ToolDefinition = {
  name: DELEGATE_TASK_NAME,
  description: [
    "Split work across sub-agents that run at the same time, each with a fresh context - on your model, or on a saved task agent's own model when you name one (agent) or one is set as the default for that kind of task.",
    "Use it for a job with independent parts - research several areas of a large codebase, build separate files or features, write tests while another part is built - or to keep a long search out of your own context.",
    "explore helpers only read and search; build helpers can edit files and run commands. Give each one everything it needs in its instructions: it cannot see this conversation or ask the user anything.",
    "Give build helpers separate files so they never edit the same one. Each returns a short report; check their work before you tell the user it is done.",
    `Up to ${MAX_SUBAGENTS} tasks per call. Do small or tightly connected work yourself instead.`,
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_SUBAGENTS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "A few words naming the task, shown to the user" },
            instructions: { type: "string", description: "Everything the helper needs: the goal, the files or area, constraints, and what to report back" },
            mode: { type: "string", enum: ["explore", "build"], description: "explore reads only; build can change files. Default explore." },
            agent: { type: "string", description: "Optional: a saved task agent's id to run this task on its own model, or \"self\" for your own model. Absent: the default agent for this mode, if one is set." },
          },
          required: ["title", "instructions"],
        },
      },
    },
    required: ["tasks"],
  },
  mutating: true,
};

/** The tasks a call asks for, or why they cannot run. */
export function parseDelegation(input: unknown): readonly SubagentTask[] | string {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["tasks"] : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return "Pass tasks: a list of one to four { title, instructions, mode } objects.";
  if (raw.length > MAX_SUBAGENTS) return `At most ${MAX_SUBAGENTS} sub-agents per call. Group the work, or do the rest after these finish.`;
  const tasks: SubagentTask[] = [];
  for (const [index, item] of raw.entries()) {
    const fields = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    const title = typeof fields["title"] === "string" ? fields["title"].trim() : "";
    const instructions = typeof fields["instructions"] === "string" ? fields["instructions"].trim() : "";
    const mode = fields["mode"] === undefined ? "explore" : fields["mode"];
    if (title === "" || instructions === "") return `Task ${index + 1} needs a title and instructions.`;
    if (mode !== "explore" && mode !== "build") return `Task ${index + 1}: mode is explore or build.`;
    const agent = typeof fields["agent"] === "string" ? fields["agent"].trim().slice(0, 80) : "";
    tasks.push({ title: title.slice(0, 80), instructions: instructions.slice(0, 20_000), mode, ...(agent === "" ? {} : { agent }) });
  }
  return tasks;
}

/** A helper's tools: reads only to explore; everything but delegation and questions to build. */
export function subagentTools(tools: readonly ToolDefinition[], mode: SubagentMode): readonly ToolDefinition[] {
  return tools.filter((tool) => tool.name !== DELEGATE_TASK_NAME && tool.name !== ASK_USER_NAME && tool.name !== CREATE_AGENT_TOOL && (mode === "build" || !tool.mutating));
}

/** The helper's first message: the task and how to finish. */
export function subagentBrief(task: SubagentTask, standing?: string): string {
  return [
    `You are a sub-agent: another agent handed you one part of a larger task. Nobody else will answer questions - work it out with your tools.`,
    ...(standing === undefined || standing.trim() === "" ? [] : [`Your standing instructions: ${standing.trim()}`]),
    task.mode === "explore"
      ? "You can read and search but not change anything. Find what was asked and report it precisely, with file paths and line numbers."
      : "You can change files and run commands. Stay inside the files and area your instructions name; other helpers may be working beside you.",
    "",
    `Task: ${task.title}`,
    task.instructions,
    "",
    "Finish with a short report for the agent that sent you: what you found or changed (file paths), how you checked it, and anything left undone or uncertain. No preamble.",
  ].join("\n");
}

export interface SubagentDeps {
  /**
   * A fresh agent with these tools: the parent's model, or the task agent the task routes to.
   * A string is why it could not be built (e.g. that agent's connection has no key).
   */
  readonly start: (task: SubagentTask, tools: readonly ToolDefinition[]) => Agent | StartedHelper | string | Promise<Agent | StartedHelper | string>;
  /** The parent's tools, read when a call arrives. */
  readonly tools: () => readonly ToolDefinition[];
  /** Live progress for the person watching, e.g. "Helper 2 of 3 · Tests: editing src/a.test.ts". */
  readonly status?: (text: string) => void;
  /** Every event a helper emits, for usage counting. */
  readonly onEvent?: (task: SubagentTask, event: AgentEvent) => void;
}

/** What a tool call is doing, in a few words. */
export function describeCall(call: ToolCallBlock): string {
  const input = typeof call.input === "object" && call.input !== null ? call.input as Record<string, unknown> : {};
  const target = ["path", "pattern", "query", "command", "url"].map((key) => input[key]).find((value): value is string => typeof value === "string" && value.length > 0);
  const verb: Record<string, string> = { read_file: "reading", list_files: "listing", search: "searching", glob_files: "finding", get_outline: "outlining", edit_file: "editing", propose_edit: "writing", move_file: "moving", delete_file: "deleting", run_command: "running", fetch_url: "fetching", view_page: "checking" };
  const action = verb[call.name] ?? call.name.replaceAll("_", " ");
  return target === undefined ? action : `${action} ${target.length > 60 ? `${target.slice(0, 57)}...` : target}`;
}

interface Outcome {
  readonly task: SubagentTask;
  readonly report: string;
  readonly steps: number;
  readonly ended: "done" | "error" | "stopped";
  readonly detail?: string;
  readonly ranOn?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** "12.3k" - tokens as the report shows them. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

async function runOne(task: SubagentTask, index: number, count: number, deps: SubagentDeps, signal: AbortSignal): Promise<Outcome> {
  const label = count > 1 ? `Helper ${index + 1} of ${count} · ${task.title}` : `Helper · ${task.title}`;
  let started: Agent | StartedHelper | string;
  try {
    started = await deps.start(task, subagentTools(deps.tools(), task.mode));
  } catch (caught) {
    started = caught instanceof Error ? caught.message : String(caught);
  }
  if (typeof started === "string") {
    deps.status?.(`${label}: failed`);
    return { task, steps: 0, ended: "error", detail: started, report: "", inputTokens: 0, outputTokens: 0 };
  }
  const helper: StartedHelper = "send" in started ? { agent: started } : started;
  const agent = helper.agent;
  const stop = (): void => agent.cancel();
  signal.addEventListener("abort", stop, { once: true });
  let text = "";
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let ended: Outcome["ended"] = "done";
  let detail: string | undefined;
  try {
    deps.status?.(`${label}: starting${helper.ranOn === undefined ? "" : ` on ${helper.ranOn}`}`);
    for await (const event of agent.send(subagentBrief(task, helper.instructions))) {
      deps.onEvent?.(task, event);
      if (event.kind === "usage") { inputTokens += event.inputTokens; outputTokens += event.outputTokens; }
      else if (event.kind === "text") text += event.text;
      else if (event.kind === "tool-call") {
        steps += 1;
        // Only the report after the last tool call is the answer; earlier text was thinking aloud.
        text = "";
        deps.status?.(`${label}: ${describeCall(event.call)}`);
      } else if (event.kind === "error") { ended = "error"; detail = event.detail; }
      else if (event.kind === "refusal") { ended = "error"; detail = `The model declined: ${event.detail}`; }
      else if (event.kind === "cancelled") ended = "stopped";
    }
  } catch (caught) {
    ended = signal.aborted ? "stopped" : "error";
    detail = caught instanceof Error ? caught.message : String(caught);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  if (signal.aborted) ended = "stopped";
  deps.status?.(`${label}: ${ended === "done" ? "finished" : ended === "stopped" ? "stopped" : "failed"}`);
  const report = text.trim();
  return { task, steps, ended, inputTokens, outputTokens, ...(detail === undefined ? {} : { detail }), ...(helper.ranOn === undefined ? {} : { ranOn: helper.ranOn }), report: report.length > REPORT_CHARS ? `${report.slice(0, REPORT_CHARS)}\n[report cut at ${REPORT_CHARS} characters]` : report };
}

/** Run the helpers together and fold their reports into one tool result. */
export async function runSubagents(tasks: readonly SubagentTask[], deps: SubagentDeps, signal: AbortSignal): Promise<ToolRunResult> {
  const outcomes = await Promise.all(tasks.map((task, index) => runOne(task, index, tasks.length, deps, signal)));
  const done = outcomes.filter((outcome) => outcome.ended === "done").length;
  const sections = outcomes.map((outcome, index) => {
    const state = outcome.ended === "done" ? "done" : outcome.ended === "stopped" ? "stopped" : `failed${outcome.detail ? `: ${outcome.detail.slice(0, 300)}` : ""}`;
    // Where it ran and what it spent, so the lead (and the person) can see the tokens went where they were meant to.
    const spent = outcome.inputTokens + outcome.outputTokens > 0 ? `${formatTokens(outcome.inputTokens)} in / ${formatTokens(outcome.outputTokens)} out tokens` : null;
    const where = [outcome.ranOn === undefined ? null : `on ${outcome.ranOn}`, spent].filter((part): part is string => part !== null).join(", ");
    return `## ${index + 1}. ${outcome.task.title} (${outcome.task.mode}) - ${state}, ${outcome.steps} tool ${outcome.steps === 1 ? "call" : "calls"}${where === "" ? "" : ` · ${where}`}\n${outcome.report || "(no report)"}`;
  });
  return {
    content: `${done} of ${outcomes.length} sub-agent${outcomes.length === 1 ? "" : "s"} finished.\n\n${sections.join("\n\n")}`,
    isError: done === 0,
  };
}

/** Answer `delegate_task` calls; pass every other call to the runner underneath. */
export function withSubagents(runner: ToolRunner, deps: SubagentDeps): ToolRunner {
  return {
    async run(call, signal) {
      if (call.name !== DELEGATE_TASK_NAME) return runner.run(call, signal);
      const tasks = parseDelegation(call.input);
      if (typeof tasks === "string") return { content: tasks, isError: true };
      return runSubagents(tasks, deps, signal);
    },
  };
}
