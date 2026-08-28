import type { AiCompletionInputView } from "../shared/api.ts";

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
