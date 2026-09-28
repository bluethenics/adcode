/**
 * Keeping a long conversation inside the model's context.
 *
 * A conversation's history grows with every question, every file read and every command
 * output. Past the model's context size a provider refuses the request, and the chat is
 * over - however much the user had built up in it. Compaction is what lets it go on: the
 * older part is replaced by a summary the same model writes, and the newest turns stay
 * word for word.
 *
 * Everything here is pure. The agent decides when to call it and does the streaming; the
 * rules that are easy to get quietly wrong live here, where they are tested:
 *
 * - **Where to cut.** A provider rejects a history in which a tool result has lost the
 *   call it answers, or a call its result. So the kept tail starts either at a user's own
 *   turn or at an assistant step, never on a message of tool results.
 * - **What the model then sees.** A summary in a user message at the front, so the history
 *   still starts with the user and still alternates.
 * - **What survives twice.** A second compaction summarises the first summary along with
 *   everything after it, so early decisions are not lost on the third.
 */
import type { Message, ToolDefinition } from "./types.ts";

export const SUMMARY_OPEN = "<conversation-summary>";
export const SUMMARY_CLOSE = "</conversation-summary>";

/** A flat per-image allowance: providers charge roughly this, whatever the base64 size. */
const IMAGE_TOKENS = 1_600;
/** Tool output kept per result in the transcript the summariser reads. */
const RESULT_CHARS = 600;
/** Tool arguments kept per call in that transcript. */
const ARGUMENT_CHARS = 200;

/**
 * About how many tokens a request's input takes.
 *
 * Deliberately conservative - three characters a token, where English averages nearer
 * four - because the cost of guessing low is a refused request and the cost of guessing
 * high is compacting a little early.
 */
export function estimateTokens(system: string, messages: readonly Message[], tools: readonly ToolDefinition[]): number {
  const fixed = Math.ceil(system.length / 3) + (tools.length === 0 ? 0 : Math.ceil(JSON.stringify(tools).length / 3));
  return messages.reduce((total, message) => total + messageTokens(message), fixed);
}

/**
 * One message's share. Additive on purpose: the cut adds messages up from the end, and a
 * total that disagreed with the sum of its parts would keep a tail over its budget.
 */
export function messageTokens(message: Message): number {
  let images = 0;
  const textual = message.content.map((block) => {
    if (block.type !== "image") return block;
    images += 1;
    return { type: "text", text: "[image]" };
  });
  return Math.ceil(JSON.stringify({ role: message.role, content: textual }).length / 3) + images * IMAGE_TOKENS;
}

/**
 * Whether the next request should be compacted first.
 *
 * The threshold is a share of what is left once the answer's own reservation is taken out -
 * but never less than half the window, so a model with a large output reservation and a
 * small window is not compacted before every request.
 */
export function compactionDue(
  tokens: number,
  contextWindow: number,
  maxOutput: number,
  thresholdPercent: number | null,
): boolean {
  if (thresholdPercent === null) return false;
  return tokens >= inputBudget(contextWindow, maxOutput) * (thresholdPercent / 100);
}

/** The input a model can take once the answer's reservation is set aside. */
export function inputBudget(contextWindow: number, maxOutput: number): number {
  return Math.max(contextWindow - maxOutput, Math.floor(contextWindow / 2));
}

const hasText = (message: Message): boolean => message.content.some((block) => block.type === "text");
const hasResults = (message: Message): boolean => message.content.some((block) => block.type === "tool-result");

/** A user's own turn: words from the user, not results the loop sent back for them. */
const isTurnStart = (message: Message): boolean => message.role === "user" && hasText(message) && !hasResults(message);

/**
 * Where the kept tail starts, or null when there is nothing worth compacting.
 *
 * Prefers the start of a user turn, keeping as many whole turns as fit in `keepTokens`.
 * When the newest turn alone is over that - one request that has read a hundred files -
 * it cuts inside that turn instead, before an assistant step, keeping the newest steps
 * that fit (at least the last one). Always leaves at least two messages to summarise.
 */
export function compactionCut(messages: readonly Message[], keepTokens: number): number | null {
  if (messages.length < 3) return null;

  // Token cost of every suffix, computed once from the end.
  const suffix: number[] = new Array<number>(messages.length + 1).fill(0);
  for (let index = messages.length - 1; index >= 0; index--) {
    suffix[index] = suffix[index + 1]! + messageTokens(messages[index]!);
  }

  let newestTurn = -1;
  for (let index = 2; index < messages.length; index++) {
    if (!isTurnStart(messages[index]!)) continue;
    if (suffix[index]! <= keepTokens) return index;
    newestTurn = index;
  }

  // The newest turn does not fit whole. Cut inside it, at an assistant step: every tool
  // result after such a step answers a call made at or after it.
  const from = Math.max(newestTurn + 1, 2);
  let lastStep: number | null = null;
  for (let index = from; index < messages.length; index++) {
    if (messages[index]!.role !== "assistant") continue;
    if (suffix[index]! <= keepTokens) return index;
    lastStep = index;
  }
  return lastStep;
}

export interface CompactionPlan {
  readonly cut: number;
  readonly older: readonly Message[];
  readonly tail: readonly Message[];
  /**
   * The words of the request being worked on, when the cut falls inside that request's
   * turn. The summary carries them verbatim so the model never loses what it was asked.
   */
  readonly request: string | null;
}

const textOf = (message: Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

export function planCompaction(messages: readonly Message[], keepTokens: number): CompactionPlan | null {
  const cut = compactionCut(messages, keepTokens);
  if (cut === null) return null;
  const tail = messages.slice(cut);
  let request: string | null = null;
  if (!tail.some(isTurnStart)) {
    for (let index = cut - 1; index >= 0; index--) {
      const message = messages[index]!;
      if (isTurnStart(message) && !isSummaryMessage(message)) {
        request = textOf(message);
        break;
      }
    }
  }
  return { cut, older: messages.slice(0, cut), tail, request };
}

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)} [… ${String(text.length - limit)} more characters]`;

/** One message as lines of a transcript a person - or a summariser - can read. */
function transcriptLines(message: Message): string[] {
  const lines: string[] = [];
  for (const block of message.content) {
    switch (block.type) {
      case "text":
        if (message.role === "user" && block.text.startsWith(SUMMARY_OPEN)) {
          lines.push(`Summary of the conversation before this point:\n${block.text}`);
        } else {
          lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${block.text}`);
        }
        break;
      case "image":
        lines.push(`${message.role === "user" ? "User" : "Assistant"}: [image]`);
        break;
      case "tool-call":
        lines.push(`Assistant → ${block.name}(${clip(JSON.stringify(block.input), ARGUMENT_CHARS)})`);
        break;
      case "tool-result":
        lines.push(`${block.isError ? "Tool error" : "Tool result"}: ${clip(block.content, RESULT_CHARS)}`);
        break;
    }
  }
  return lines;
}

const SUMMARISER_SYSTEM = [
  "You summarise a conversation between a user and ADCode's coding assistant so the assistant can continue it with",
  "only your summary and the newest messages. Nothing you leave out can be recovered, so be complete about what",
  "matters and brief about what does not. Write in plain text with these headings, skipping any that would be empty:",
  "Goal - what the user is trying to achieve, and their current request in their own words.",
  "Decisions - what was decided and why, including anything the user rejected.",
  "Files - each file created, changed or important to the work, and its current state.",
  "Done - what is finished and verified.",
  "Open - what is unfinished, failing or promised next.",
  "Remember - the user's preferences, conventions and anything they asked to be remembered, verbatim.",
  "Avoid - approaches that failed, and why.",
  "Do not invent anything. Do not address the user. Do not include tool output beyond what a later step needs.",
].join("\n");

/**
 * The request that asks the model for a summary of `older`.
 *
 * No tools, one user message holding a transcript. `maxChars` bounds that transcript: when
 * it is over, the oldest part goes first - an earlier summary sits at the front and is
 * kept, since it already stands for everything before it.
 */
export function summaryRequest(
  older: readonly Message[],
  focus?: string,
  maxChars = 400_000,
): { system: string; messages: Message[] } {
  const entries = older.map((message) => transcriptLines(message).join("\n")).filter((entry) => entry.length > 0);
  const pinned = older[0] !== undefined && isSummaryMessage(older[0]) ? entries.shift() : undefined;

  let budget = maxChars - (pinned?.length ?? 0);
  const kept: string[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.length > budget) {
      // The newest message alone is over: keep its end, which is where a request is.
      const omitted = kept.length === 0 ? index : index + 1;
      if (kept.length === 0) kept.unshift(entry.slice(entry.length - Math.max(budget, 0)));
      if (omitted > 0) kept.unshift(`[${String(omitted)} earlier messages omitted]`);
      break;
    }
    kept.unshift(entry);
    budget -= entry.length + 2;
  }

  const transcript = [...(pinned === undefined ? [] : [pinned]), ...kept].join("\n\n");
  const ask = focus !== undefined && focus.trim().length > 0
    ? `Summarise the conversation above. The user asked you to pay particular attention to: ${focus.trim()}`
    : "Summarise the conversation above.";
  return {
    system: SUMMARISER_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: `${transcript}\n\n---\n${ask}` }] }],
  };
}

function summaryText(summary: string, request: string | null | undefined): string {
  return [
    `${SUMMARY_OPEN}\n${summary.trim()}\n${SUMMARY_CLOSE}`,
    ...(request === null || request === undefined ? [] : [`The request being worked on, in the user's words:\n${request}`]),
    "This summary replaces the earlier part of the conversation. Continue from it; read files again rather than trusting remembered contents.",
  ].join("\n\n");
}

/**
 * The history after compaction: the summary, then the kept tail.
 *
 * The summary rides in the tail's first message when that is the user's, so two user
 * messages never sit side by side. Tool results, which some providers insist come first
 * in a user message, stay first.
 */
export function compactedHistory(summary: string, tail: readonly Message[], request?: string | null): Message[] {
  const block = { type: "text" as const, text: summaryText(summary, request) };
  const first = tail[0];
  if (first === undefined) return [{ role: "user", content: [block] }];
  if (first.role === "assistant") return [{ role: "user", content: [block] }, ...tail];
  const results = first.content.filter((one) => one.type === "tool-result");
  const rest = first.content.filter((one) => one.type !== "tool-result");
  return [{ role: "user", content: [...results, block, ...rest] }, ...tail.slice(1)];
}

/** Whether a message is where an earlier compaction put its summary. */
export function isSummaryMessage(message: Message): boolean {
  if (message.role !== "user") return false;
  const text = message.content.find((block) => block.type === "text");
  return text !== undefined && text.type === "text" && text.text.startsWith(SUMMARY_OPEN);
}
