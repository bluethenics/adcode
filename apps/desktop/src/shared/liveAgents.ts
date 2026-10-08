/**
 * What a live agent window is told, and how it is told without flooding the window.
 *
 * Two producers share this: the main process, forwarding a Team or solo agent's events on
 * `ai:live`, and the chat, mapping its own assistant's events. Both send the same trimmed
 * shape - a tool call's path and line counts, never its contents; a tool's output tail,
 * never all of it - because the window shows work happening, not a second copy of it.
 *
 * Pure and dependency-free, so both sides and the tests use one definition.
 */

/** Which background agent an event belongs to. */
export interface LiveSourceView {
  readonly teamId: string;
  readonly nodeId: string;
  readonly roleId: string;
  readonly label: string;
  readonly model: string;
  readonly kind: "team" | "solo";
}

export type LiveEventView =
  | { readonly kind: "start" }
  | { readonly kind: "thinking" }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tool-call";
      readonly id: string;
      readonly name: string;
      readonly path: string | null;
      readonly command: string | null;
      readonly added: number;
      readonly removed: number;
    }
  | {
      readonly kind: "tool-draft";
      readonly id: string;
      readonly name: string;
      readonly path: string | null;
      readonly edit: number;
      readonly append: string;
    }
  | { readonly kind: "tool-result"; readonly id: string; readonly name: string; readonly ok: boolean; readonly output: string }
  /** The agent posted or updated its plan. */
  | { readonly kind: "plan"; readonly steps: readonly LivePlanStep[] }
  /** This agent sent a teammate a message. `to` is a role id, or "all". */
  | { readonly kind: "message"; readonly to: string; readonly text: string }
  /** This agent edited a path another role on its team had already edited. */
  | { readonly kind: "overlap"; readonly withRole: string; readonly path: string }
  | { readonly kind: "end"; readonly ok: boolean };

export interface LivePlanStep {
  readonly step: string;
  readonly status: "pending" | "in_progress" | "done";
}

export interface LiveAgentEventView {
  readonly source: LiveSourceView;
  readonly event: LiveEventView;
}

const COMMAND_LIMIT = 200;
const OUTPUT_LIMIT = 4_000;

function lineCount(text: unknown): number {
  return typeof text === "string" && text.length > 0 ? text.split("\n").length : 0;
}

/** What a window shows of a tool call: the file or command, and how many lines it adds and removes. */
export function toolCallSummary(
  name: string,
  input: Readonly<Record<string, unknown>>,
): { readonly path: string | null; readonly command: string | null; readonly added: number; readonly removed: number } {
  const path = typeof input["path"] === "string" ? input["path"] : null;
  const command = name === "run_command" && typeof input["command"] === "string" ? input["command"].slice(0, COMMAND_LIMIT) : null;
  let added = 0;
  let removed = 0;
  if (name === "propose_edit") added = lineCount(input["contents"]);
  if (name === "edit_file") {
    const edits = Array.isArray(input["edits"]) ? (input["edits"] as unknown[]) : [input];
    for (const edit of edits) {
      if (typeof edit !== "object" || edit === null) continue;
      const record = edit as Record<string, unknown>;
      added += lineCount(record["new_string"]);
      removed += lineCount(record["old_string"]);
    }
  }
  return { path, command, added, removed };
}

function planSteps(raw: unknown): LivePlanStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const step = typeof record["step"] === "string" ? record["step"].trim().slice(0, 200) : "";
    const status = record["status"];
    if (step.length === 0 || (status !== "pending" && status !== "in_progress" && status !== "done")) return [];
    return [{ step, status }];
  });
}

/** The subset of an agent event this module reads - structural, so no package import is needed. */
export type LiveAgentEventLike =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: { readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> } }
  | { readonly kind: "tool-draft"; readonly id: string; readonly name: string; readonly path: string | null; readonly edit: number; readonly append: string }
  | { readonly kind: "tool-result"; readonly toolCallId: string; readonly name: string; readonly content: string; readonly isError: boolean }
  | { readonly kind: string };

/** An agent event as a window sees it, or null for events a window does not show. */
export function liveEventFrom(event: LiveAgentEventLike): LiveEventView | null {
  if (event.kind === "text" && "text" in event) return { kind: "text", text: event.text };
  if (event.kind === "thinking") return { kind: "thinking" };
  if (event.kind === "tool-call" && "call" in event && event.call.name === "update_plan") {
    return { kind: "plan", steps: planSteps(event.call.input["steps"]) };
  }
  if (event.kind === "tool-call" && "call" in event) {
    return { kind: "tool-call", id: event.call.id, name: event.call.name, ...toolCallSummary(event.call.name, event.call.input) };
  }
  if (event.kind === "tool-draft" && "append" in event) {
    return { kind: "tool-draft", id: event.id, name: event.name, path: event.path, edit: event.edit, append: event.append };
  }
  if (event.kind === "tool-result" && "toolCallId" in event) {
    return { kind: "tool-result", id: event.toolCallId, name: event.name, ok: !event.isError, output: event.content.slice(-OUTPUT_LIMIT) };
  }
  return null;
}

type DraftShape = { kind: "tool-draft"; id: string; name: string; path: string | null; edit: number; append: string };

/**
 * Coalesce code drafts into one message per frame.
 *
 * A model streams code in fragments of a few characters, tens of times a second; sending each
 * one across IPC and re-rendering for it is wasted work. Drafts for the same call and edit are
 * merged until `schedule`'s callback runs (about a frame later). Any other event flushes the
 * pending drafts first, so the window never sees a result before the code it belongs to.
 */
export function createLiveBatcher<T extends { readonly kind: string }>(
  send: (event: T) => void,
  schedule: (flush: () => void) => void,
): { push(event: T): void; flush(): void } {
  let pending: DraftShape[] = [];
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    if (pending.length === 0) return;
    const out = pending;
    pending = [];
    for (const draft of out) send(draft as unknown as T);
  }

  return {
    push(event) {
      if (event.kind !== "tool-draft") {
        flush();
        send(event);
        return;
      }
      const draft = event as unknown as DraftShape;
      const last = pending.at(-1);
      if (last !== undefined && last.id === draft.id && last.edit === draft.edit) {
        last.append += draft.append;
        if (draft.path !== null) last.path = draft.path;
      } else {
        pending.push({ ...draft });
      }
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
    flush,
  };
}
