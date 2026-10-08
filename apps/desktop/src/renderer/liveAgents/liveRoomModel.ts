/**
 * The live room's state: one window per agent, and the signals passing between them.
 *
 * A pure reducer. Events arrive from three places - the chat's own assistant, Team and solo
 * agents over `ai:live`, and Team-in-the-terminal panes - and all of them land here as
 * `LiveEventView`s against an identity, so one model draws every kind of agent the same way.
 *
 * Signals (a message, a handoff, an overlap) are queued for the view to animate and kept in a
 * short log. They are only ever things that happened: an agent called message_teammate, a node
 * finished and its dependents received its handoff, two roles edited one file.
 */
import { EDIT_SEPARATOR, type LiveEventView, type LivePlanStep } from "../../shared/liveAgents.ts";
import { isCheckCommand } from "../../shared/runEvidence.ts";

export interface LiveAgentIdentity {
  /** Unique across the room: "chat", "<teamId>/<nodeId>", "terminal/<nodeId>". */
  readonly id: string;
  readonly label: string;
  /** The role id, which is what messages and overlaps name. */
  readonly role: string;
  readonly model: string;
  /** What picks the mascot's shape and colour. */
  readonly lookKey: string;
  /** The team this agent belongs to; messages never cross teams. */
  readonly group: string;
}

export type LiveActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "thinking" }
  | { readonly kind: "code"; readonly toolId: string; readonly path: string | null; readonly text: string; readonly edit: number; readonly final: boolean }
  | { readonly kind: "command"; readonly toolId: string; readonly command: string; readonly output: string; readonly final: boolean }
  | { readonly kind: "text"; readonly text: string };

export interface LiveFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

export type LiveProof = "passed" | "failed" | "unverified";

export interface LiveAgent extends LiveAgentIdentity {
  readonly status: "working" | "done" | "failed";
  /** One line: what it is doing now. */
  readonly step: string;
  readonly activity: LiveActivity;
  readonly files: readonly LiveFile[];
  readonly plan: readonly LivePlanStep[];
  readonly checks: readonly { readonly command: string; readonly ok: boolean }[];
  readonly proof: LiveProof;
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Check commands started and not yet answered, by tool call id. */
  readonly pendingChecks: Readonly<Record<string, string>>;
}

export interface LiveSignal {
  readonly id: number;
  readonly kind: "message" | "handoff" | "overlap";
  /** Agent ids. */
  readonly from: string;
  readonly to: readonly string[];
  readonly text: string;
  readonly at: number;
}

export interface LiveRoomState {
  readonly agents: readonly LiveAgent[];
  /** The newest signals, oldest first, for the one-line log. */
  readonly log: readonly LiveSignal[];
  /** Signals the view has not animated yet. */
  readonly signals: readonly LiveSignal[];
  readonly nextSignal: number;
}

const CODE_LIMIT = 60_000;
const TEXT_LIMIT = 600;
const OUTPUT_LIMIT = 4_000;
const LOG_LIMIT = 20;
const EDIT_TOOLS = new Set(["edit_file", "propose_edit"]);

export function emptyLiveRoom(): LiveRoomState {
  return { agents: [], log: [], signals: [], nextSignal: 1 };
}

function fresh(identity: LiveAgentIdentity, now: number): LiveAgent {
  return {
    ...identity,
    status: "working",
    step: "Getting started",
    activity: { kind: "idle" },
    files: [],
    plan: [],
    checks: [],
    proof: "unverified",
    startedAt: now,
    endedAt: null,
    pendingChecks: {},
  };
}

function proofOf(checks: readonly { readonly command: string; readonly ok: boolean }[]): LiveProof {
  if (checks.length === 0) return "unverified";
  const latest = new Map<string, boolean>();
  for (const check of checks) latest.set(check.command, check.ok);
  return [...latest.values()].some((ok) => !ok) ? "failed" : "passed";
}

/** What a tool call looks like as the window's one-line step. */
function stepFor(event: Extract<LiveEventView, { kind: "tool-call" }>): string {
  const where = event.path ?? "";
  switch (event.name) {
    case "edit_file":
    case "propose_edit":
      return `Writing ${where || "a file"}`;
    case "run_command":
      return `Running ${event.command ?? "a command"}`;
    case "read_file":
      return `Reading ${where || "a file"}`;
    case "list_files":
      return `Looking through ${where || "the project"}`;
    case "search":
      return "Searching the project";
    case "glob_files":
      return "Finding files";
    case "get_outline":
      return `Outlining ${where || "a file"}`;
    case "fetch_url":
      return "Reading a web page";
    case "project_context":
    case "memory_search":
      return "Checking project memory";
    case "memory_write":
      return "Writing to project memory";
    case "message_teammate":
      return "Messaging a teammate";
    case "read_messages":
      return "Reading messages";
    default:
      return `Using ${event.name.replaceAll("_", " ")}`;
  }
}

function withSignal(state: LiveRoomState, signal: Omit<LiveSignal, "id">): LiveRoomState {
  const full: LiveSignal = { ...signal, id: state.nextSignal };
  return {
    ...state,
    nextSignal: state.nextSignal + 1,
    log: [...state.log, full].slice(-LOG_LIMIT),
    signals: [...state.signals, full].slice(-LOG_LIMIT),
  };
}

/** The agents on `from`'s team that hold `role` ("all": everyone else on the team). */
function recipients(state: LiveRoomState, from: LiveAgent, role: string): string[] {
  return state.agents
    .filter((agent) => agent.group === from.group && agent.id !== from.id && (role === "all" || agent.role === role))
    .map((agent) => agent.id);
}

function reduceAgent(agent: LiveAgent, event: LiveEventView, now: number): LiveAgent {
  const activity = agent.activity;
  const busy = (activity.kind === "code" || activity.kind === "command") && !activity.final;
  switch (event.kind) {
    case "start":
      return agent;
    case "thinking":
      return { ...agent, step: busy ? agent.step : "Thinking", activity: activity.kind === "idle" || activity.kind === "text" ? { kind: "thinking" } : activity };
    case "text": {
      if (busy) return agent;
      const before = activity.kind === "text" ? activity.text : "";
      return { ...agent, step: "Writing a reply", activity: { kind: "text", text: `${before}${event.text}`.slice(-TEXT_LIMIT) } };
    }
    case "tool-draft": {
      const same = activity.kind === "code" && activity.toolId === event.id;
      const before = same ? activity.text : "";
      const joined = same && activity.edit !== event.edit && before.length > 0 ? `${before}${EDIT_SEPARATOR}${event.append}` : `${before}${event.append}`;
      const path = event.path ?? (same ? activity.path : null);
      return {
        ...agent,
        step: `Writing ${path ?? "a file"}`,
        activity: { kind: "code", toolId: event.id, path, text: joined.slice(-CODE_LIMIT), edit: event.edit, final: false },
      };
    }
    case "tool-call": {
      const step = stepFor(event);
      let next: LiveAgent = { ...agent, step };
      if (EDIT_TOOLS.has(event.name)) {
        if (event.path !== null) {
          const files = [...agent.files];
          const index = files.findIndex((file) => file.path === event.path);
          if (index === -1) files.push({ path: event.path, added: event.added, removed: event.removed });
          else files[index] = { path: event.path, added: files[index]!.added + event.added, removed: files[index]!.removed + event.removed };
          next = { ...next, files };
        }
        const same = activity.kind === "code" && activity.toolId === event.id;
        const text = same && activity.text.length > 0 ? activity.text : event.preview.slice(-CODE_LIMIT);
        next = { ...next, activity: { kind: "code", toolId: event.id, path: event.path ?? (same ? activity.path : null), text, edit: same ? activity.edit : 0, final: false } };
      } else if (event.name === "run_command" && event.command !== null) {
        next = { ...next, activity: { kind: "command", toolId: event.id, command: event.command, output: "", final: false } };
        if (isCheckCommand(event.command)) next = { ...next, pendingChecks: { ...agent.pendingChecks, [event.id]: event.command } };
      }
      return next;
    }
    case "tool-result": {
      let next: LiveAgent = agent;
      if (activity.kind === "code" && activity.toolId === event.id) next = { ...next, activity: { ...activity, final: true } };
      if (activity.kind === "command" && activity.toolId === event.id) {
        next = { ...next, activity: { ...activity, output: event.output.slice(-OUTPUT_LIMIT), final: true } };
      }
      const command = agent.pendingChecks[event.id];
      if (command !== undefined) {
        const { [event.id]: _answered, ...rest } = agent.pendingChecks;
        const checks = [...agent.checks, { command, ok: event.ok }];
        next = { ...next, pendingChecks: rest, checks, proof: proofOf(checks) };
      }
      return next;
    }
    case "plan":
      return { ...agent, plan: event.steps };
    case "message":
    case "overlap":
      return agent;
    case "end": {
      const settled = activity.kind === "code" || activity.kind === "command" ? { ...activity, final: true } : activity;
      return { ...agent, status: event.ok ? "done" : "failed", step: event.ok ? "Finished" : "Stopped", activity: settled, endedAt: now };
    }
  }
}

/** Apply one event from one agent. Unknown agents are added; a finished agent that starts again starts fresh. */
export function applyLiveEvent(state: LiveRoomState, identity: LiveAgentIdentity, event: LiveEventView, now: number): LiveRoomState {
  const index = state.agents.findIndex((agent) => agent.id === identity.id);
  const existing = index === -1 ? null : state.agents[index]!;
  const restart = existing !== null && existing.status !== "working" && event.kind === "start";
  const base = existing === null || restart ? fresh(identity, now) : { ...existing, label: identity.label, model: identity.model };
  const agent = reduceAgent(base, event, now);
  const agents = index === -1 ? [...state.agents, agent] : state.agents.map((candidate, at) => (at === index ? agent : candidate));
  let next: LiveRoomState = { ...state, agents };

  if (event.kind === "message") {
    next = withSignal(next, { kind: "message", from: agent.id, to: recipients(next, agent, event.to), text: event.text, at: now });
  } else if (event.kind === "overlap") {
    next = withSignal(next, { kind: "overlap", from: agent.id, to: recipients(next, agent, event.withRole), text: event.path, at: now });
  }
  return next;
}

/** Record a signal the room learned some other way - a handoff, read off the team's record. */
export function addLiveSignal(state: LiveRoomState, signal: Omit<LiveSignal, "id">): LiveRoomState {
  return withSignal(state, signal);
}

/** Hand the queued signals to the view to animate, once each. */
export function takeLiveSignals(state: LiveRoomState): [LiveRoomState, LiveSignal[]] {
  if (state.signals.length === 0) return [state, []];
  return [{ ...state, signals: [] }, [...state.signals]];
}

/** Drop agents that finished more than `keepMs` ago. */
export function pruneLiveRoom(state: LiveRoomState, now: number, keepMs: number): LiveRoomState {
  const agents = state.agents.filter((agent) => agent.endedAt === null || now - agent.endedAt <= keepMs);
  return agents.length === state.agents.length ? state : { ...state, agents };
}
