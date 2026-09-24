/**
 * Inline edit: rewrite a selection in place from one instruction.
 *
 * The editor's Ctrl+E. Unlike the agent, this is one tool-free request whose whole answer
 * is the replacement text, so the result can land in the buffer as an undoable change the
 * user accepts or rejects on the spot. Pure: request shaping and answer cleaning only.
 */
import type { ProviderRequest } from "./types.ts";

export interface InlineEditInput {
  readonly instruction: string;
  readonly languageId: string;
  readonly path: string;
  /** Text above the selection, trimmed to a window by the caller. */
  readonly before: string;
  /** The selected text. Empty means "insert at the cursor". */
  readonly selection: string;
  readonly after: string;
}

/** Characters of surrounding code sent on each side of the selection. */
export const INLINE_EDIT_CONTEXT_CHARS = 6_000;
export const INLINE_EDIT_MAX_SELECTION = 24_000;

const SYSTEM = [
  "You rewrite code inside an editor. The user selected a region and gave an instruction.",
  "Return ONLY the replacement for the selected region: no markdown fences, no explanation,",
  "no text from before or after the selection. Keep the surrounding indentation and style,",
  "and keep everything the instruction does not ask you to change. If the selection is",
  "empty, return only the new code to insert at the cursor.",
].join(" ");

export function buildInlineEditRequest(model: string, input: InlineEditInput, maxTokens = 4096): ProviderRequest {
  const before = input.before.slice(-INLINE_EDIT_CONTEXT_CHARS);
  const after = input.after.slice(0, INLINE_EDIT_CONTEXT_CHARS);
  return {
    model,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `File: ${input.path}`,
              `Language: ${input.languageId}`,
              "<before-selection>",
              before,
              "</before-selection>",
              input.selection.length === 0 ? "<selection empty=\"true\"></selection>" : "<selection>",
              ...(input.selection.length === 0 ? [] : [input.selection, "</selection>"]),
              "<after-selection>",
              after,
              "</after-selection>",
              `Instruction: ${input.instruction.trim()}`,
            ].join("\n"),
          },
        ],
      },
    ],
    tools: [],
    maxTokens,
  };
}

/**
 * The answer as insertable text.
 *
 * Models fence code even when told not to, and some add a one-line preamble before the
 * fence. Take the fenced body when there is exactly one fence pair; otherwise the answer
 * as written. A selection that ended in a newline keeps ending in one, so accepting the
 * edit never glues the next line onto the last.
 */
export function cleanInlineEditAnswer(answer: string, selection: string): string {
  let text = answer.replace(/\r\n/g, "\n");
  const fences = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n?```[ \t]*$/gm)];
  if (fences.length === 1) text = fences[0]![1] ?? "";
  else text = text.replace(/^\n+/, "");
  const normalizedSelection = selection.replace(/\r\n/g, "\n");
  if (normalizedSelection.endsWith("\n") && !text.endsWith("\n")) text += "\n";
  if (!normalizedSelection.endsWith("\n") && text.endsWith("\n") && normalizedSelection.length > 0) {
    text = text.replace(/\n+$/, "");
  }
  return text;
}
