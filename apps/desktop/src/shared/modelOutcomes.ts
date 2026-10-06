/**
 * How an assistant turn ended, as one fixed word.
 *
 * "All AI models must be working" needs to know which ones are not - for real people, not in
 * a test. Each finished turn reports its provider, model, one of these words and how long it
 * took; the admin panel's Models page shows how often each model works. Never the prompt, the
 * reply, a file, a key or the provider's own message: the wire has no field that could carry
 * one.
 *
 * `services/api/src/modelOutcomes.ts` keeps the server's copy of this list; its test fails if
 * the two drift. The wording rules mirror `renderer/ai/aiFailure.ts`, which turns the same
 * messages into sentences.
 */

export const MODEL_OUTCOMES = [
  "ok",
  "refused",
  "cancelled",
  "auth",
  "credits",
  "rate_limit",
  "too_large",
  "model_missing",
  "no_tools",
  "tool_format",
  "network",
  "server",
  "output_limit",
  "thinking_limit",
  "history",
  "other",
] as const;

export type ModelOutcome = (typeof MODEL_OUTCOMES)[number];

const KNOWN: ReadonlySet<string> = new Set(MODEL_OUTCOMES);

export const isModelOutcome = (value: unknown): value is ModelOutcome => typeof value === "string" && KNOWN.has(value);

/** The fixed word for an error a turn ended with. */
export function outcomeOfError(detail: string): ModelOutcome {
  if (/output allowance thinking/i.test(detail)) return "thinking_limit";
  if (/response limit/i.test(detail)) return "output_limit";
  if (/thought_signature|thought signature|thinking block.*(?:signature|bound)/i.test(detail)) return "history";
  if (/HTTP 413|request too large|context[_ ]length|maximum context|too many tokens|prompt is too long|reduce the length/i.test(detail)) return "too_large";
  if (/HTTP 429|rate[_ ]limit|too many requests|tokens per (minute|day)|requests per (minute|day)|\bTPM\b|\bRPM\b/i.test(detail)) return "rate_limit";
  if (/HTTP 40[13]\b|invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed|authentication|permission denied|forbidden/i.test(detail)) return "auth";
  if (/insufficient[_ ](credit|quota|balance)|credit|billing|payment required|HTTP 402|quota (?:is )?(?:reached|exceeded)|exceeded your (?:current )?quota/i.test(detail)) return "credits";
  if (/does not support tools|tool use is not supported|tools are not supported|function calling is not supported|not support function|endpoints found that support tool/i.test(detail)) return "no_tools";
  if (/tool_use_failed|failed to call a function|invalid tool call|malformed (?:tool|function)|failed_generation|tool call validation/i.test(detail)) return "tool_format";
  if (/HTTP 404|model[^.]{0,40}(not found|does not exist|not available|decommissioned|deprecated)|unknown model|no such model|No endpoints found for|\(code 404\)/i.test(detail)) return "model_missing";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up|network|timed? ?out|getaddrinfo/i.test(detail)) return "network";
  if (/HTTP 5\d\d|overloaded|service unavailable|internal server error|bad gateway|temporarily unavailable/i.test(detail)) return "server";
  return "other";
}
