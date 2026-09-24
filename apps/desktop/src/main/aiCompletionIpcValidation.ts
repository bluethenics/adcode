import type { AiCompletionInputView, AiInlineEditInputView } from "../shared/api.ts";

const MAX_PREFIX = 6_000;
const MAX_SUFFIX = 2_000;

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AI completion request must be an object");
  }
  return value as Record<string, unknown>;
};

export function parseAiCompletionInput(value: unknown): AiCompletionInputView {
  const input = record(value);
  const requestId = input["requestId"];
  const languageId = input["languageId"];
  const prefix = input["prefix"];
  const suffix = input["suffix"];
  if (!Number.isSafeInteger(requestId) || (requestId as number) < 0) {
    throw new Error("AI completion request id is invalid");
  }
  if (typeof languageId !== "string" || !/^[a-z0-9+_.#-]{1,40}$/i.test(languageId)) {
    throw new Error("AI completion language is invalid");
  }
  if (typeof prefix !== "string" || prefix.length > MAX_PREFIX) {
    throw new Error("AI completion prefix is too large");
  }
  if (typeof suffix !== "string" || suffix.length > MAX_SUFFIX) {
    throw new Error("AI completion suffix is too large");
  }
  return { requestId: requestId as number, languageId, prefix, suffix };
}

const MAX_INSTRUCTION = 4_000;
const MAX_CONTEXT = 12_000;
const MAX_SELECTION = 24_000;

/** Ctrl+E's request. Bounded here, where the renderer's trimming becomes enforcement. */
export function parseAiInlineEditInput(value: unknown): AiInlineEditInputView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Inline edit request must be an object");
  }
  const input = value as Record<string, unknown>;
  const { instruction, languageId, path, before, selection, after } = input;
  if (typeof instruction !== "string" || instruction.trim().length === 0 || instruction.length > MAX_INSTRUCTION) {
    throw new Error("Inline edit instruction is invalid");
  }
  if (typeof languageId !== "string" || !/^[a-z0-9+_.#-]{1,40}$/i.test(languageId)) {
    throw new Error("Inline edit language is invalid");
  }
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) throw new Error("Inline edit path is invalid");
  if (typeof before !== "string" || before.length > MAX_CONTEXT) throw new Error("Inline edit context is too large");
  if (typeof after !== "string" || after.length > MAX_CONTEXT) throw new Error("Inline edit context is too large");
  if (typeof selection !== "string" || selection.length > MAX_SELECTION) throw new Error("Inline edit selection is too large");
  return { instruction, languageId, path, before, selection, after };
}
