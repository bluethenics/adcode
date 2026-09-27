/**
 * Keeping requests small enough for the model the user picked.
 *
 * A free-tier Groq model can allow ~6,000 tokens a minute, and ADCode's instructions and
 * tool definitions alone are more than half of that. A turn that has read a few files
 * then fails with "Request too large" - and used to fail the same way on every retry.
 * These are the pieces of the agent's fallback: recognise the refusal, then resend with
 * a lean request - the core tools, a short system prompt, and old tool output trimmed.
 */
import type { Message, ToolDefinition } from "./types.ts";

/** The tools a coding turn cannot do without. Memory, MCP, skills and fetch wait. */
export const LEAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "list_files",
  "search",
  "glob_files",
  "get_outline",
  "edit_file",
  "propose_edit",
  "run_command",
  "open_preview",
]);

export const LEAN_SYSTEM = [
  "You are the coding assistant built into ADCode. Do the work with the tools instead of describing it,",
  "and never ask for anything a tool call could find out.",
  "Read before you edit. Change existing files with edit_file (exact old and new text); create files with",
  "propose_edit. Paths are workspace-relative; omit the path for the workspace root.",
  "The host context below says whether edits apply at once or wait for review. Report a change only when",
  "a tool result confirms it, and finish with a short summary of what changed.",
].join("\n");

/** Older tool output beyond this is trimmed in a lean request; the latest step's is kept whole. */
export const LEAN_RESULT_CHARS = 1_500;

const number = (text: string | undefined): number => Number((text ?? "").replace(/,/g, ""));

/**
 * Whether a provider refused a request for its size.
 *
 * Either it says so ("Request too large", "maximum context length", HTTP 413), or it states
 * a per-minute allowance smaller than the request - which no amount of waiting will fix.
 */
export function isRequestTooLarge(detail: string): boolean {
  if (/HTTP 413|request too large|context[_ ]length|maximum context|too many tokens|prompt is too long|reduce (?:the length|your message size)/i.test(detail)) {
    return true;
  }
  const limit = /\blimit\s*:?\s*(\d[\d,]*)/i.exec(detail)?.[1];
  const requested = /\brequested\s*:?\s*(\d[\d,]*)/i.exec(detail)?.[1];
  return limit !== undefined && requested !== undefined && number(requested) > number(limit);
}

/** The core tools only, in their original order. */
export function leanTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => LEAN_TOOL_NAMES.has(tool.name));
}

/**
 * The history with old tool output trimmed.
 *
 * File reads and command output are most of a long turn's size. Only the most recent
 * message keeps its tool results whole - it is what the model is about to act on - and
 * the model is told it can read a file again when it needs the rest.
 */
export function leanHistory(messages: readonly Message[], keep = LEAN_RESULT_CHARS): Message[] {
  const last = messages.length - 1;
  return messages.map((message, index) => {
    if (index === last || !message.content.some((block) => block.type === "tool-result" && block.content.length > keep)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === "tool-result" && block.content.length > keep
          ? { ...block, content: `${block.content.slice(0, keep)}\n[Trimmed to keep the request small - read it again if you need the rest.]` }
          : block,
      ),
    };
  });
}
