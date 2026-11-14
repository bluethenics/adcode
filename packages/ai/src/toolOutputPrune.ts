/**
 * Clearing tool output the model no longer needs, in batches the provider's cache survives.
 *
 * Every step of an agent turn sends the whole conversation again, and file reads and command
 * output are most of it. Much of that is dead weight by step ten: a file read before it was
 * edited (the model has since seen the edit), the same file read twice, a test run three runs
 * ago. Sending it again costs tokens on every step and buries what matters.
 *
 * Two kinds of output are cleared, leaving a one-line note in their place:
 *
 * - **Superseded**: a `read_file` of a path that was changed later in the conversation, or
 *   read again from the same line. What it says is out of date, so it is wrong as well as
 *   long. A later page of a long file supersedes nothing: it is different text.
 * - **Old**: output beyond the newest `PRUNE_PROTECT_TOKENS` of tool output. The model can
 *   call the tool again for anything it still needs, and the note says so.
 *
 * Never cleared: the newest message's results (what the model is about to act on), answers the
 * person gave (`ask_user`), skill instructions, the plan, project memory, a helper's report,
 * and anything short enough that a note saves nothing.
 *
 * **Why batches.** Providers cache a request's prefix, and changing an old message spends that
 * cache from the change onward. So nothing is cleared until at least `PRUNE_MINIMUM_TOKENS`
 * can go at once; between batches the history is byte-for-byte what it was and every step
 * reads it from cache. Decisions only ever grow, so a cleared result stays cleared.
 *
 * The conversation itself is untouched - the agent's history, the saved chat and its tool
 * cards keep every byte. Only what is sent changes.
 */
import type { Message, ToolCallBlock } from "./types.ts";

/**
 * The newest tool output, in tokens, that is always sent whole - about the last five file
 * reads or command runs. Chosen by replaying a 23-step task (docs/token-efficiency-2026-11-13.md):
 * 16k with 6k batches cut the input sent by a fifth; going lower saved little more and starts
 * costing re-reads.
 */
export const PRUNE_PROTECT_TOKENS = 16_000;
/** Clear nothing until at least this many tokens can go at once (see "Why batches"). */
export const PRUNE_MINIMUM_TOKENS = 6_000;
/** Output shorter than this is never cleared: the note would save almost nothing. */
const PRUNE_MIN_RESULT_CHARS = 600;
/** About four characters to a token for code and prose: the same rough count the agent uses elsewhere. */
const CHARS_PER_TOKEN = 4;

export const PRUNED_NOTE = "[Earlier tool output cleared to save tokens; it may be out of date. Call the tool again if you still need it.]";

/** Results the model must keep: what the person said, instructions it follows, its own plan. */
const KEPT_TOOLS: ReadonlySet<string> = new Set([
  "ask_user",
  "load_skill",
  "load_builtin_skill",
  "update_plan",
  "project_context",
  "delegate_task",
  "discover_capabilities",
]);

/** Tools that change a file, by the input fields that name it. */
const WRITES_PATH: Readonly<Record<string, readonly string[]>> = {
  edit_file: ["path"],
  propose_edit: ["path"],
  delete_file: ["path"],
  move_file: ["from", "to"],
};

/** Which page of a file a read was: its first line, 1 when it started at the top. */
const pageOf = (input: Record<string, unknown>): number => {
  const offset = input["offset"];
  return typeof offset === "number" && Number.isFinite(offset) && offset > 1 ? Math.floor(offset) : 1;
};

const tokensOf = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const pathOf = (input: Record<string, unknown>, field: string): string | null => {
  const value = input[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\\/g, "/").replace(/^\.\//, "") : null;
};

interface ResultSpot {
  readonly id: string;
  readonly message: number;
  readonly tokens: number;
  readonly prunable: boolean;
}

/**
 * Which tool results to clear now, given those already cleared. Returns the whole set -
 * `already` plus any new ones - or `already` itself when no batch is due.
 */
export function planToolOutputPrune(
  messages: readonly Message[],
  already: ReadonlySet<string>,
  options: { readonly protectTokens?: number; readonly minimumTokens?: number } = {},
): ReadonlySet<string> {
  const protect = options.protectTokens ?? PRUNE_PROTECT_TOKENS;
  const minimum = options.minimumTokens ?? PRUNE_MINIMUM_TOKENS;
  const last = messages.length - 1;

  const calls = new Map<string, { readonly call: ToolCallBlock; readonly message: number }>();
  messages.forEach((message, index) => {
    for (const block of message.content) if (block.type === "tool-call") calls.set(block.id, { call: block, message: index });
  });

  // When each path was last written, and each page of it last read, by message index.
  const lastWritten = new Map<string, number>();
  const lastRead = new Map<string, number>();
  const later = (map: Map<string, number>, key: string, message: number): void => { map.set(key, Math.max(map.get(key) ?? -1, message)); };
  for (const { call, message } of calls.values()) {
    if (call.name === "read_file") {
      const path = pathOf(call.input, "path");
      if (path !== null) later(lastRead, `${path}#${String(pageOf(call.input))}`, message);
      continue;
    }
    for (const field of WRITES_PATH[call.name] ?? []) {
      const path = pathOf(call.input, field);
      if (path !== null) later(lastWritten, path, message);
    }
  }

  const spots: ResultSpot[] = [];
  const superseded = new Set<string>();
  messages.forEach((message, index) => {
    for (const block of message.content) {
      if (block.type !== "tool-result") continue;
      const origin = calls.get(block.toolCallId);
      const prunable = index !== last && block.content.length >= PRUNE_MIN_RESULT_CHARS && origin !== undefined && !KEPT_TOOLS.has(origin.call.name);
      spots.push({ id: block.toolCallId, message: index, tokens: tokensOf(block.content), prunable });
      if (prunable && origin.call.name === "read_file") {
        const path = pathOf(origin.call.input, "path");
        const page = `${path ?? ""}#${String(pageOf(origin.call.input))}`;
        if (path !== null && ((lastWritten.get(path) ?? -1) > origin.message || (lastRead.get(page) ?? -1) > origin.message)) superseded.add(block.toolCallId);
      }
    }
  });

  // Walk back from the newest output; past the protected amount, the rest is old.
  const fresh = new Set<string>();
  let seen = 0;
  for (let index = spots.length - 1; index >= 0; index--) {
    const spot = spots[index]!;
    if (seen < protect) fresh.add(spot.id);
    seen += spot.tokens;
  }

  let freed = 0;
  const next = new Set(already);
  for (const spot of spots) {
    if (!spot.prunable || already.has(spot.id)) continue;
    if (superseded.has(spot.id) || !fresh.has(spot.id)) {
      next.add(spot.id);
      freed += spot.tokens;
    }
  }
  return freed >= minimum ? next : already;
}

/** The history as it is sent: each cleared result replaced by its note. Shares unchanged messages. */
export function applyToolOutputPrune(messages: readonly Message[], cleared: ReadonlySet<string>): Message[] {
  if (cleared.size === 0) return [...messages];
  return messages.map((message) => {
    if (!message.content.some((block) => block.type === "tool-result" && cleared.has(block.toolCallId))) return message;
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === "tool-result" && cleared.has(block.toolCallId) ? { ...block, content: PRUNED_NOTE } : block,
      ),
    };
  });
}
