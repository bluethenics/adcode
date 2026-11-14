/**
 * One assistant turn, drawn as a timeline: what it thought, what it did, and what it said
 * along the way, in the order it happened.
 *
 *     Working for 54s ⌄
 *     ✧ Thinking   The user wants a landing page with pricing…            ›
 *     I'll start with the hero, then the pricing table.
 *     ⌕ Search project · 3 calls   pricing                                ›
 *     ✎ Edit file   src/App.tsx   ▦                                       ›
 *
 * Presentation only, like `chatActivity.ts`: the chat widget turns the agent's events into
 * calls here, and this module owns the markup, the clock and the motion. The pieces that are
 * worth testing without a DOM - the heading, the thinking summary, tool labels and grouping -
 * are plain functions at the top.
 *
 * - **One timeline per turn.** Thinking rows, tool rows and the text written between them all
 *   live inside it, so collapsing it to "Worked for 2m 31s" folds the whole process away.
 * - **The answer stays out.** When the turn ends, whatever text came after the last step is
 *   moved out below the timeline, so the folded turn reads: heading, then the answer.
 * - **A run of one tool is one row.** Eleven searches in a row are "Search project · 11
 *   calls", with each call a click away. Anything in between - thinking, text - starts a
 *   new row, because the timeline reads in order.
 * - **One face at work.** The mascot sits in the heading while the turn runs and leaves
 *   when it ends; live rows carry the small pixel spinner instead of a face of their own.
 * - **Helpers are their own rows.** A `delegate_task` call opens one row per sub-agent -
 *   title, mode, what it is doing right now - and each helper's report sits a click away
 *   when it ends.
 */

import { createIcon, ICON } from "../workbench/icons.ts";
import { renderChatMessageHtml } from "./chatMarkdown.ts";
import type { MascotHandle, MascotMood } from "./mascot.ts";
import { createAdcodeMascot, moodForAssistant } from "../mascot/adcodeMascot.ts";

/** Buck behind the turn mascot's own small interface, so the timeline needs no other change. */
function buckForTurn(): MascotHandle {
  const buck = createAdcodeMascot({ mood: moodForAssistant("thinking"), size: 26, interactive: true, label: "Buck, the ADCode mascot. Activate for a reaction." });
  return {
    element: buck.element,
    setMood: (mood: MascotMood) => buck.setMood(moodForAssistant(mood)),
    poke: () => { buck.play("poked"); return ""; },
    destroy: () => buck.destroy(),
  };
}

export type TurnOutcome = "running" | "worked" | "thought" | "failed" | "stopped" | "declined";

/** "54s", "2m 31s", "3m", "1h 2m" - whole units, never less than a second. */
export function formatTurnDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${String(total)}s`;
  if (total < 3_600) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  }
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

/** The heading's two halves: the word that carries the state, and the time beside it. */
export function turnHeading(outcome: TurnOutcome, seconds: number): { readonly lead: string; readonly rest: string } {
  const time = formatTurnDuration(seconds);
  switch (outcome) {
    case "running": return { lead: "Working", rest: `for ${time}` };
    case "worked": return { lead: "Worked", rest: `for ${time}` };
    case "thought": return { lead: "Thought", rest: `for ${time}` };
    case "failed": return { lead: "Failed", rest: `after ${time}` };
    case "stopped": return { lead: "Stopped", rest: `after ${time}` };
    case "declined": return { lead: "Declined", rest: "" };
  }
}

const SUMMARY_LIMIT = 160;

/**
 * A thinking row's one line: the first line of the thought, with the markdown markers a
 * model wraps its own headings in taken off, so `**Planning**` reads as "Planning".
 */
export function thinkingSummary(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > SUMMARY_LIMIT ? `${plain.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : plain;
}

/** The one call drawn as its helpers rather than as a row of its own. */
const DELEGATE_TASK_NAME = "delegate_task";

const STEP_LABELS: Readonly<Record<string, string>> = {
  read_file: "Read file",
  list_files: "List files",
  glob_files: "Find files",
  search: "Search project",
  get_outline: "Outline file",
  edit_file: "Edit file",
  propose_edit: "Edit file",
  delete_file: "Delete file",
  move_file: "Move file",
  run_command: "Run command",
  command_output: "Check command",
  stop_command: "Stop command",
  fetch_url: "Read URL",
  view_page: "View page",
  audit_page: "Check page",
  open_preview: "Open preview",
  update_plan: "Update plan",
  ask_user: "Ask the user",
  delegate_task: "Helpers",
  create_agent: "Create task agent",
  fork_chats: "Start fork chats",
  send_chat_message: "Message chat",
  read_chat_messages: "Read chat messages",
  wait_for_chat_forks: "Wait for forks",
  list_chat_forks: "List fork chats",
  stop_chat: "Stop chat",
  project_context: "Read project notes",
  inspect_project: "Inspect project",
  run_project_checks: "Check project",
  discover_capabilities: "Find tools",
  load_skill: "Read skill",
  load_builtin_skill: "Read skill",
  call_mcp: "Use MCP tool",
  adcode_features: "Look up ADCode",
  adcode_action: "Use ADCode",
  adcode_connectors: "Set up connector",
  message_teammate: "Message teammate",
  read_messages: "Read messages",
};

/** What a row calls a tool: "Read file", "Search project". An unknown tool still reads as words. */
export function toolStepLabel(name: string): string {
  const clean = name.trim();
  if (clean.length === 0) return "Use a tool";
  const known = STEP_LABELS[clean];
  if (known !== undefined) return known;
  if (/^memory/i.test(clean)) return "Project memory";
  const words = clean.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ToolStepIcon = "search" | "globe" | "file" | "edit" | "terminal" | "eye" | "checklist" | "plug" | "tool";

/** The row's icon, by what the tool does rather than by its exact name. */
export function toolStepIcon(name: string): ToolStepIcon {
  const clean = name.trim();
  if (clean === "update_plan" || clean === "delegate_task" || clean === "fork_chats" || clean === "wait_for_chat_forks") return "checklist";
  if (clean === "send_chat_message" || clean === "stop_chat") return "tool";
  if (clean === "read_chat_messages" || clean === "list_chat_forks") return "file";
  if (clean === "call_mcp" || clean === "discover_capabilities" || clean === "adcode_connectors") return "plug";
  if (clean === "adcode_features" || clean === "adcode_action") return "tool";
  if (clean === "view_page" || clean === "audit_page" || clean === "open_preview") return "eye";
  if (/fetch|url|web/i.test(clean)) return "globe";
  if (/search|grep|glob|find/i.test(clean)) return "search";
  if (/edit|write|patch|apply|delete|move/i.test(clean)) return "edit";
  if (/run|exec|command|terminal|check/i.test(clean)) return "terminal";
  if (/read|list|outline|context|memory|skill|inspect|messages/i.test(clean)) return "file";
  return "tool";
}

/** "11 calls" beside a grouped row; nothing for a single call, whose detail says enough. */
export function toolGroupCount(calls: number): string {
  return calls > 1 ? `${String(calls)} calls` : "";
}

/** A tool call joins the row above only if that row is a run of the same tool. */
export function joinsToolGroup(last: { readonly kind: string; readonly name?: string } | null, name: string): boolean {
  return last !== null && last.kind === "tools" && last.name === name;
}

/* ── Sub-agents (helpers) ─────────────────────────────────────────────── */

/** One task a `delegate_task` call hands to a helper. */
export interface HelperTask {
  readonly title: string;
  readonly mode: "explore" | "build";
}

/**
 * The helpers a `delegate_task` call asks for, in the words its status lines will use - or
 * none, when the input is not shaped like a call that runs. The rules are `parseDelegation`'s
 * (`packages/ai/src/subagents.ts`): one to four tasks, each with a title, instructions and
 * a known mode. A call the main process would refuse draws no rows of its own.
 */
export function helperTasksFrom(input: unknown): readonly HelperTask[] {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["tasks"] : undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return [];
  const tasks: HelperTask[] = [];
  for (const item of raw) {
    const fields = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const title = typeof fields["title"] === "string" ? fields["title"].trim() : "";
    const instructions = typeof fields["instructions"] === "string" ? fields["instructions"].trim() : "";
    const mode = fields["mode"] === undefined ? "explore" : fields["mode"];
    if (title === "" || instructions === "" || (mode !== "explore" && mode !== "build")) return [];
    tasks.push({ title: title.slice(0, 80), mode });
  }
  return tasks;
}

/** Which helper a live status line is about, and what it says. */
export interface HelperStatus {
  /** 0-based, in the call's own order. */
  readonly index: number;
  readonly title: string;
  /** "starting", "editing src/a.ts", "finished". */
  readonly detail: string;
  readonly state: "running" | "done" | "stopped" | "error";
}

/**
 * Reads a helper's progress line - "Helper 2 of 3 · Tests: editing src/a.test.ts" - against
 * the call's own tasks. The exact title is known here, so matching is by whole prefix rather
 * than by splitting on punctuation a title might contain. Null for anything else.
 */
export function matchHelperStatus(text: string, tasks: readonly HelperTask[]): HelperStatus | null {
  const clean = text.trim();
  if (!clean.startsWith("Helper ")) return null;
  for (const [index, task] of tasks.entries()) {
    const prefix = tasks.length > 1
      ? `Helper ${String(index + 1)} of ${String(tasks.length)} · ${task.title}: `
      : `Helper · ${task.title}: `;
    if (!clean.startsWith(prefix)) continue;
    const detail = clean.slice(prefix.length).trim();
    if (detail.length === 0) return null;
    const state = detail === "finished" ? "done" : detail === "stopped" ? "stopped" : detail === "failed" ? "error" : "running";
    return { index, title: task.title, detail, state };
  }
  return null;
}

/** How one helper ended, and what it said, from a `delegate_task` result. */
export interface HelperOutcome {
  readonly index: number;
  readonly ended: "done" | "stopped" | "failed";
  readonly calls: number;
  readonly report: string;
  /** Where it ran and what it spent, e.g. "on deepseek-chat as DeepSeek coder, 12k in / 2.1k out tokens". */
  readonly ranOn?: string;
}

/**
 * "## 2. Tests (build) - done, 3 tool calls": the heading `runSubagents` writes per helper,
 * with " · on <model> as <agent>, 12k in / 2.1k out tokens" after it when it knows them.
 */
const HELPER_REPORT_HEADING = /^## (\d+)\. .+ \((?:explore|build)\) - (done|stopped|failed)(?:: .*)?, (\d+) tool calls?(?: · (.+))?$/;

/**
 * The sections of a `delegate_task` result, in order. Only the exact heading shape starts a
 * new section, so a report that itself contains markdown headings stays whole. "(no report)"
 * comes back as empty text.
 */
export function parseHelperReports(content: string): readonly HelperOutcome[] {
  interface Section { index: number; ended: "done" | "stopped" | "failed"; calls: number; ranOn: string; lines: string[] }
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of content.split("\n")) {
    const heading = HELPER_REPORT_HEADING.exec(line);
    if (heading !== null) {
      if (current !== null) sections.push(current);
      current = { index: Number(heading[1]) - 1, ended: heading[2] as Section["ended"], calls: Number(heading[3]), ranOn: heading[4] ?? "", lines: [] };
    } else if (current !== null) current.lines.push(line);
  }
  if (current !== null) sections.push(current);
  return sections.map((section) => {
    const report = section.lines.join("\n").trim();
    return { index: section.index, ended: section.ended, calls: section.calls, ...(section.ranOn === "" ? {} : { ranOn: section.ranOn }), report: report === "(no report)" ? "" : report };
  });
}

const ICON_PATHS: Readonly<Record<ToolStepIcon | "sparkle", string>> = {
  sparkle: ICON.sparkle,
  search: ICON.search,
  globe: ICON.globe,
  file: ICON.file,
  edit: ICON.edit,
  terminal: ICON.terminal,
  eye: ICON.eye,
  checklist: ICON.checklist,
  plug: ICON.plug,
  tool: ICON.tool,
};

/**
 * The pixel mosaic that means "working": a 3×3 grid whose cells light in a scattered order.
 * Decorative - the row beside it carries the words.
 */
export function createPixelSpinner(size: "row" | "turn" = "row"): HTMLElement {
  const spinner = document.createElement("span");
  spinner.className = `chat-pixel-spinner is-${size}`;
  spinner.setAttribute("aria-hidden", "true");
  for (let cell = 0; cell < 9; cell += 1) spinner.append(document.createElement("i"));
  return spinner;
}

export interface ToolCallInput {
  readonly id: string;
  readonly name: string;
  /** The call's input in one line: a path, a query, a command. */
  readonly detail: string;
  /** The raw input, for the calls whose input is their content (delegate_task's tasks). */
  readonly input?: unknown;
}

export interface TurnTimeline {
  readonly element: HTMLElement;
  readonly startedAt: number;
  /** Host progress beside the heading - "Waiting 21s for the rate limit". Null clears it. */
  setStatus(text: string | null): void;
  /** A thinking delta: extends the live thinking row, or starts one. */
  thinking(text: string): void;
  toolCall(call: ToolCallInput): void;
  /** A tool finished. Without an id, the newest running call is the one that finished. */
  toolResult(id: string | null, ok: boolean): void;
  /** A helper's live line ("Helper 2 of 3 · Tests: editing src/a.ts"): true when it was one. */
  helperStatus(text: string): boolean;
  /** A finished delegate_task result: settle its rows and file each helper's report. */
  helperResult(id: string | null, content: string, ok: boolean): void;
  /** Text written between steps. It stays in the timeline unless it turns out to be the answer. */
  appendText(node: HTMLElement): void;
  hasSteps(): boolean;
  /** End the turn: settle live rows, release the answer below, fold the rest away. */
  finish(outcome: Exclude<TurnOutcome, "running"> | "auto"): void;
  /** Drop it without finishing (the conversation is being replaced). */
  destroy(): void;
}

interface CallRow {
  readonly element: HTMLElement;
  readonly group: GroupStep;
  status: "running" | "done" | "error";
}

interface GroupStep {
  readonly kind: "tools";
  readonly name: string;
  readonly element: HTMLElement;
  readonly count: HTMLElement;
  readonly detail: HTMLElement;
  readonly list: HTMLElement;
  calls: number;
  running: number;
}

interface ThinkingStep {
  readonly kind: "thinking";
  readonly element: HTMLElement;
  readonly summary: HTMLElement;
  readonly detail: HTMLElement;
  text: string;
}

interface HelperRow {
  readonly element: HTMLElement;
  readonly mark: HTMLElement;
  readonly detail: HTMLElement;
  readonly calls: HTMLElement;
  readonly chevron: HTMLElement;
  readonly report: HTMLElement;
  state: "running" | "done" | "stopped" | "error";
}

interface HelperStep {
  readonly kind: "helpers";
  readonly element: HTMLElement;
  readonly summary: HTMLElement;
  readonly tasks: readonly HelperTask[];
  readonly rows: readonly HelperRow[];
  running: number;
  /** The settled line ("all 3 finished"), once the call's result has arrived. */
  settled: string | null;
}

type Last = GroupStep | ThinkingStep | HelperStep | { readonly kind: "text" } | null;

function icon(name: ToolStepIcon | "sparkle"): HTMLElement {
  const holder = document.createElement("span");
  holder.className = "chat-step-icon";
  holder.append(createIcon(ICON_PATHS[name]));
  return holder;
}

/** A step: a row that opens to show its detail, with the grid-rows collapse the turn uses. */
function stepShell(kind: "thinking" | "tools" | "helpers", iconName: ToolStepIcon | "sparkle", label: string): {
  readonly element: HTMLElement;
  readonly row: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly body: HTMLElement;
} {
  const element = document.createElement("div");
  element.className = `chat-step is-${kind}`;
  element.dataset["step"] = kind;
  element.dataset["state"] = "running";
  element.dataset["open"] = "false";

  const row = document.createElement("button");
  row.type = "button";
  row.className = "chat-step-row";
  row.setAttribute("aria-expanded", "false");
  const name = document.createElement("span");
  name.className = "chat-step-label";
  name.textContent = label;
  row.append(icon(iconName), name);

  const collapse = document.createElement("div");
  collapse.className = "chat-step-collapse";
  const body = document.createElement("div");
  body.className = "chat-step-detail";
  collapse.append(body);

  row.addEventListener("click", () => {
    const open = element.dataset["open"] !== "true";
    element.dataset["open"] = String(open);
    row.setAttribute("aria-expanded", String(open));
  });
  element.append(row, collapse);
  return { element, row, label: name, body };
}

function chevron(): HTMLElement {
  const holder = document.createElement("span");
  holder.className = "chat-step-chevron";
  holder.append(createIcon(ICON.chevronRight));
  return holder;
}

export function createTurnTimeline(options?: { readonly startedAt?: number }): TurnTimeline {
  const startedAt = options?.startedAt ?? Date.now();

  const element = document.createElement("section");
  element.className = "chat-turn";
  element.dataset["state"] = "running";
  element.dataset["collapsed"] = "false";
  element.setAttribute("aria-label", "The assistant's work on this turn");

  const header = document.createElement("div");
  header.className = "chat-turn-header";
  // Buck, small, in every turn's header: his face follows the work (moodForAssistant).
  const mascot = buckForTurn();
  // Poking the mascot must not fold the turn.
  mascot.element.addEventListener("click", (event) => event.stopPropagation());
  const face = document.createElement("span");
  face.className = "chat-turn-face";
  face.append(mascot.element);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "chat-turn-toggle";
  toggle.setAttribute("aria-expanded", "true");
  const lead = document.createElement("strong");
  lead.className = "chat-turn-lead";
  const rest = document.createElement("span");
  rest.className = "chat-turn-rest";
  // The clock ticks every second; a screen reader should not read it out each time.
  rest.setAttribute("aria-hidden", "true");
  const status = document.createElement("span");
  status.className = "chat-turn-status";
  status.hidden = true;
  const turnChevron = document.createElement("span");
  turnChevron.className = "chat-turn-chevron";
  turnChevron.append(createIcon(ICON.chevronDown));
  toggle.append(lead, rest, status, turnChevron);
  header.append(face, toggle);

  const collapse = document.createElement("div");
  collapse.className = "chat-turn-collapse";
  const body = document.createElement("div");
  body.className = "chat-turn-body";
  collapse.append(body);
  element.append(header, collapse);

  const paintHeading = (outcome: TurnOutcome, seconds: number): void => {
    const heading = turnHeading(outcome, seconds);
    lead.textContent = heading.lead;
    rest.textContent = heading.rest;
  };
  const tick = (): void => paintHeading("running", (Date.now() - startedAt) / 1000);
  tick();
  let clock: number | null = window.setInterval(tick, 1_000);

  const setCollapsed = (collapsed: boolean): void => {
    element.dataset["collapsed"] = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toggle.addEventListener("click", () => setCollapsed(element.dataset["collapsed"] !== "true"));

  let last: Last = null;
  let toolsSeen = 0;
  let stepsSeen = 0;
  const calls = new Map<string, CallRow>();
  const running: CallRow[] = [];
  const helperSteps = new Map<string, HelperStep>();
  const helperOrder: HelperStep[] = [];

  const settleThinking = (): void => {
    if (last?.kind !== "thinking") return;
    last.element.dataset["state"] = "done";
    last.element.querySelector(".chat-pixel-spinner")?.remove();
    const label = last.element.querySelector(".chat-step-label");
    if (label !== null) label.textContent = "Thinking";
    // Streamed as plain text; once whole, a thought reads like the reply does - bold, lists,
    // code - through the same escaping renderer.
    last.detail.innerHTML = renderChatMessageHtml(last.text);
    last.detail.classList.add("is-rendered");
  };

  const paintGroup = (group: GroupStep): void => {
    const counted = toolGroupCount(group.calls);
    group.count.textContent = counted.length === 0 ? "" : `· ${counted}`;
    group.count.hidden = counted.length === 0;
    group.element.dataset["state"] = group.running > 0 ? "running" : group.element.dataset["state"] === "error" ? "error" : "done";
    const spinner = group.element.querySelector(".chat-step-row > .chat-pixel-spinner");
    if (group.running > 0 && spinner === null) group.element.querySelector(".chat-step-chevron")?.before(createPixelSpinner());
    if (group.running === 0) spinner?.remove();
  };

  const settleCall = (row: CallRow, ok: boolean): void => {
    if (row.status !== "running") return;
    row.status = ok ? "done" : "error";
    row.element.dataset["state"] = row.status;
    const mark = row.element.querySelector(".chat-step-call-mark");
    mark?.replaceChildren(createIcon(ok ? ICON.check : ICON.severityError));
    row.group.running = Math.max(0, row.group.running - 1);
    if (!ok) row.group.element.dataset["state"] = "error";
    const index = running.indexOf(row);
    if (index >= 0) running.splice(index, 1);
    paintGroup(row.group);
  };

  /* ── Helpers: one row per sub-agent ── */

  /** One helper's row: its words, its state, and - once it ends - its report behind a click. */
  const buildHelperRow = (task: HelperTask): HelperRow => {
    const element = document.createElement("li");
    element.className = "chat-helper";
    element.dataset["state"] = "running";
    element.dataset["open"] = "false";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "chat-helper-row";
    row.setAttribute("aria-expanded", "false");
    const mark = document.createElement("span");
    mark.className = "chat-helper-mark";
    mark.append(createPixelSpinner());
    const title = document.createElement("span");
    title.className = "chat-helper-title";
    title.textContent = task.title;
    title.title = task.title;
    const mode = document.createElement("span");
    mode.className = "chat-helper-mode";
    mode.textContent = task.mode;
    const detail = document.createElement("span");
    detail.className = "chat-helper-detail";
    const count = document.createElement("span");
    count.className = "chat-helper-calls";
    count.hidden = true;
    const reportChevron = document.createElement("span");
    reportChevron.className = "chat-helper-chevron";
    reportChevron.hidden = true;
    reportChevron.append(createIcon(ICON.chevronRight));
    row.append(mark, title, mode, detail, count, reportChevron);

    const collapse = document.createElement("div");
    collapse.className = "chat-helper-collapse";
    const report = document.createElement("div");
    report.className = "chat-helper-report";
    collapse.append(report);

    row.addEventListener("click", () => {
      const open = element.dataset["open"] !== "true";
      element.dataset["open"] = String(open);
      row.setAttribute("aria-expanded", String(open));
    });
    element.append(row, collapse);
    return { element, mark, detail, calls: count, chevron: reportChevron, report, state: "running" };
  };

  /** A helper settles once: its spinner gives way to how it ended. */
  const settleHelper = (step: HelperStep, row: HelperRow, state: HelperRow["state"], detail?: string): void => {
    if (row.state === "running" && state !== "running") step.running = Math.max(0, step.running - 1);
    row.state = state;
    row.element.dataset["state"] = state;
    if (state !== "running") {
      row.mark.replaceChildren(createIcon(state === "done" ? ICON.check : state === "error" ? ICON.severityError : ICON.severityWarning));
    }
    if (detail !== undefined) row.detail.textContent = detail;
  };

  const helperState = (ended: HelperOutcome["ended"]): HelperRow["state"] => ended === "done" ? "done" : ended === "stopped" ? "stopped" : "error";

  /** The step's face: a spinner while any helper runs, the settled line once they have ended. */
  const paintHelpers = (step: HelperStep): void => {
    const spinner = step.element.querySelector(".chat-step-row > .chat-pixel-spinner");
    if (step.running > 0 && spinner === null) step.element.querySelector(".chat-step-chevron")?.before(createPixelSpinner());
    if (step.running === 0) spinner?.remove();
    const failed = step.rows.some((row) => row.state === "error");
    step.element.dataset["state"] = step.running > 0 ? "running" : failed ? "error" : "done";
    if (step.settled !== null) step.summary.textContent = step.settled;
  };

  /** A `delegate_task` call: one step, its rows named by the tasks the call carries. */
  const createHelperStep = (call: ToolCallInput, tasks: readonly HelperTask[]): void => {
    const shell = stepShell("helpers", "checklist", toolStepLabel(call.name));
    const count = document.createElement("span");
    count.className = "chat-step-count";
    count.textContent = `· ${String(tasks.length)} task${tasks.length === 1 ? "" : "s"}`;
    const summary = document.createElement("span");
    summary.className = "chat-step-summary";
    summary.textContent = call.detail;
    shell.row.append(count, summary, chevron());
    const list = document.createElement("ol");
    list.className = "chat-step-helpers";
    const rows = tasks.map((task) => {
      const row = buildHelperRow(task);
      list.append(row.element);
      return row;
    });
    shell.body.append(list);
    shell.row.querySelector(".chat-step-chevron")?.before(createPixelSpinner());
    append(shell.element);
    stepsSeen += 1;
    // Delegating is work: a turn of nothing but helpers reads "Worked", not "Thought".
    toolsSeen += 1;
    const step: HelperStep = { kind: "helpers", element: shell.element, summary, tasks, rows, running: rows.length, settled: null };
    helperSteps.set(call.id, step);
    helperOrder.push(step);
    last = step;
  };

  /** The plain tool settling, shared by `toolResult` and `helperResult`'s fallback. */
  const settleToolResult = (id: string | null, ok: boolean): void => {
    const row = (id === null ? undefined : calls.get(id)) ?? running[running.length - 1];
    if (row !== undefined) settleCall(row, ok);
    if (!ok && element.dataset["state"] === "running") mascot.setMood("error");
  };

  const append = (node: HTMLElement): void => {
    body.append(node);
  };

  /**
   * The answer is what came after the last step. Moving it out below the timeline is what
   * lets the folded turn read "Worked for 2m 31s", then the answer - not a closed box with
   * the answer inside it.
   */
  const releaseAnswer = (): void => {
    const children = [...body.children] as HTMLElement[];
    let lastStep = -1;
    children.forEach((child, index) => {
      if (child.dataset["step"] !== undefined) lastStep = index;
    });
    let anchor: Element = element;
    for (const child of children.slice(lastStep + 1)) {
      anchor.after(child);
      anchor = child;
    }
  };

  const setStatus = (text: string | null): void => {
    const clean = text?.trim() ?? "";
    status.textContent = clean;
    status.hidden = clean.length === 0;
  };

  return {
    element,
    startedAt,
    setStatus,
    thinking(text: string): void {
      if (text.length === 0) return;
      setStatus(null);
      if (element.dataset["state"] === "running") mascot.setMood("thinking");
      if (last?.kind === "thinking" && last.element.dataset["state"] === "running") {
        last.text += text;
        last.detail.append(document.createTextNode(text));
        // The summary is the first line; once that line is complete it stops changing.
        if (last.text.length < SUMMARY_LIMIT * 2) last.summary.textContent = thinkingSummary(last.text);
        return;
      }
      const shell = stepShell("thinking", "sparkle", "Thinking…");
      const summary = document.createElement("span");
      summary.className = "chat-step-summary";
      summary.textContent = thinkingSummary(text);
      shell.row.append(summary, createPixelSpinner(), chevron());
      shell.body.classList.add("is-thought");
      shell.body.append(document.createTextNode(text));
      append(shell.element);
      stepsSeen += 1;
      last = { kind: "thinking", element: shell.element, summary, detail: shell.body, text };
    },
    toolCall(call: ToolCallInput): void {
      settleThinking();
      setStatus(null);
      mascot.setMood("working");
      // A delegation is its helpers: one row each, not a run of "Helpers" calls.
      const tasks = helperTasksFrom(call.input);
      if (call.name === DELEGATE_TASK_NAME && tasks.length > 0) {
        createHelperStep(call, tasks);
        return;
      }
      let group: GroupStep;
      if (last !== null && last.kind === "tools" && joinsToolGroup(last, call.name)) {
        group = last;
      } else {
        const shell = stepShell("tools", toolStepIcon(call.name), toolStepLabel(call.name));
        const count = document.createElement("span");
        count.className = "chat-step-count";
        count.hidden = true;
        const detail = document.createElement("span");
        detail.className = "chat-step-summary";
        shell.row.append(count, detail, chevron());
        const list = document.createElement("ol");
        list.className = "chat-step-calls";
        shell.body.append(list);
        append(shell.element);
        stepsSeen += 1;
        group = { kind: "tools", name: call.name, element: shell.element, count, detail, list, calls: 0, running: 0 };
        last = group;
      }
      group.calls += 1;
      group.running += 1;
      toolsSeen += 1;
      group.detail.textContent = call.detail;
      group.detail.title = call.detail;

      const item = document.createElement("li");
      item.className = "chat-step-call";
      item.dataset["state"] = "running";
      const mark = document.createElement("span");
      mark.className = "chat-step-call-mark";
      mark.append(createPixelSpinner());
      const text = document.createElement("span");
      text.className = "chat-step-call-text";
      text.textContent = call.detail.length > 0 ? call.detail : toolStepLabel(call.name);
      item.append(mark, text);
      group.list.append(item);

      const row: CallRow = { element: item, group, status: "running" };
      calls.set(call.id, row);
      running.push(row);
      paintGroup(group);
    },
    toolResult: settleToolResult,
    helperStatus(text: string): boolean {
      for (let index = helperOrder.length - 1; index >= 0; index -= 1) {
        const step = helperOrder[index];
        if (step === undefined || step.running === 0) continue;
        const update = matchHelperStatus(text, step.tasks);
        if (update === null) continue;
        const row = step.rows[update.index];
        if (row === undefined || row.state !== "running") continue;
        if (update.state === "running") row.detail.textContent = update.detail;
        else settleHelper(step, row, update.state, update.detail);
        step.summary.textContent = `${update.title}: ${update.detail}`;
        paintHelpers(step);
        return true;
      }
      return false;
    },
    helperResult(id: string | null, content: string, ok: boolean): void {
      const step = (id === null ? undefined : helperSteps.get(id)) ?? helperOrder.filter((open) => open.running > 0).at(-1);
      if (step === undefined) {
        // Not a call this timeline drew as helpers: plain settling still applies.
        settleToolResult(id, ok);
        return;
      }
      const outcomes = parseHelperReports(content);
      const seen = new Set<number>();
      for (const outcome of outcomes) {
        const row = step.rows[outcome.index];
        if (row === undefined || seen.has(outcome.index)) continue;
        seen.add(outcome.index);
        // The live line ("finished") usually already said it; a row without one gets it now.
        const detail = (row.detail.textContent ?? "").length === 0 ? (outcome.ended === "done" ? "finished" : outcome.ended) : undefined;
        settleHelper(step, row, helperState(outcome.ended), detail);
        row.calls.textContent = `${String(outcome.calls)} ${outcome.calls === 1 ? "call" : "calls"}${outcome.ranOn === undefined ? "" : ` · ${outcome.ranOn}`}`;
        row.calls.hidden = false;
        if (outcome.report.length > 0) {
          row.report.innerHTML = renderChatMessageHtml(outcome.report);
          row.report.classList.add("is-rendered");
          row.element.dataset["hasReport"] = "true";
          row.chevron.hidden = false;
        }
      }
      // A helper the result never described still stops spinning.
      for (const row of step.rows) if (row.state === "running") settleHelper(step, row, ok ? "done" : "error", ok ? "finished" : "failed");
      const done = step.rows.filter((row) => row.state === "done").length;
      const failed = step.rows.filter((row) => row.state === "error").length;
      const stopped = step.rows.filter((row) => row.state === "stopped").length;
      if (outcomes.length === 0 && !ok) {
        step.settled = (content.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "The helpers could not run").slice(0, 200);
      } else if (failed > 0 || stopped > 0) {
        const parts: string[] = [];
        if (done > 0) parts.push(`${String(done)} finished`);
        if (failed > 0) parts.push(`${String(failed)} failed`);
        if (stopped > 0) parts.push(`${String(stopped)} stopped`);
        step.settled = parts.join(" · ");
      } else {
        step.settled = step.tasks.length === 1 ? "finished" : `all ${String(step.tasks.length)} finished`;
      }
      paintHelpers(step);
    },
    appendText(node: HTMLElement): void {
      settleThinking();
      setStatus(null);
      if (element.dataset["state"] === "running") mascot.setMood("streaming");
      append(node);
      last = { kind: "text" };
    },
    hasSteps(): boolean {
      return stepsSeen > 0;
    },
    finish(outcome: Exclude<TurnOutcome, "running"> | "auto"): void {
      if (element.dataset["state"] !== "running") return;
      if (clock !== null) window.clearInterval(clock);
      clock = null;
      settleThinking();
      // Every live row settles: a finished turn with a spinner still spinning reads as hung.
      for (const row of [...running]) settleCall(row, outcome !== "failed");
      for (const step of helperOrder) {
        for (const row of step.rows) {
          if (row.state === "running") settleHelper(step, row, outcome === "failed" ? "error" : "done");
        }
        if (step.settled === null && (outcome === "failed" || outcome === "stopped" || outcome === "declined")) step.settled = outcome;
        paintHelpers(step);
      }
      setStatus(null);
      mascot.destroy();
      releaseAnswer();
      const resolved: Exclude<TurnOutcome, "running"> = outcome === "auto" ? (toolsSeen > 0 ? "worked" : "thought") : outcome;
      element.dataset["state"] = "done";
      element.dataset["outcome"] = resolved;
      paintHeading(resolved, (Date.now() - startedAt) / 1000);
      // Nothing happened but text: it has all been released, and there is no work to fold.
      if (stepsSeen === 0) {
        element.remove();
        return;
      }
      setCollapsed(true);
    },
    destroy(): void {
      if (clock !== null) window.clearInterval(clock);
      clock = null;
      mascot.destroy();
      element.remove();
      calls.clear();
      running.length = 0;
      helperSteps.clear();
      helperOrder.length = 0;
    },
  };
}
