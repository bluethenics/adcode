import { describe, expect, it } from "vitest";
import { MODEL_OUTCOMES, isModelOutcome, outcomeOfError } from "../src/shared/modelOutcomes.ts";

/**
 * How an assistant turn ended, as one fixed word.
 *
 * "All AI models must be working" needs to know which ones are not - for real people, not
 * in a test. Each finished turn reports its provider, model, one of these words and how long
 * it took: never the prompt, the reply, a file, a key or the provider's own message.
 */
describe("outcomeOfError", () => {
  it.each([
    ["OpenAI returned HTTP 401: Incorrect API key provided", "auth"],
    ["OpenRouter returned HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 120.", "credits"],
    ["Groq returned HTTP 429: Rate limit reached for model on tokens per minute (TPM)", "rate_limit"],
    ["Anthropic returned HTTP 400: prompt is too long: 250000 tokens > 200000 maximum", "too_large"],
    ["OpenRouter: No endpoints found for stealth/space-bunny-alpha. (code 404)", "model_missing"],
    ["OpenRouter: No endpoints found that support tool use. (code 404)", "no_tools"],
    ["Groq: Failed to call a function. Please adjust your prompt. (code tool_use_failed)", "tool_format"],
    ["fetch failed", "network"],
    ["Anthropic returned HTTP 529: Overloaded", "server"],
    ["The model reached its response limit before completing this turn.", "output_limit"],
    ["The model spent its whole output allowance thinking and wrote nothing.", "thinking_limit"],
    ["Google returned HTTP 400: Function call is missing a thought_signature in functionCall parts. (INVALID_ARGUMENT)", "history"],
    ["something nobody planned for", "other"],
  ])("%s -> %s", (detail, outcome) => {
    expect(outcomeOfError(detail)).toBe(outcome);
  });
});

describe("the vocabulary", () => {
  it("is fixed words only, shared with the server", () => {
    expect(MODEL_OUTCOMES).toContain("ok");
    expect(MODEL_OUTCOMES.every((one) => /^[a-z_]{1,24}$/.test(one))).toBe(true);
    expect(isModelOutcome("ok")).toBe(true);
    expect(isModelOutcome("Incorrect API key")).toBe(false);
  });
});
