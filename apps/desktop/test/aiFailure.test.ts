import { describe, expect, it } from "vitest";
import { CONTINUE_PROMPT, describeAiFailure, OUTPUT_LIMIT_AGAIN, providerFrom, resumeAfterModelSwitch } from "../src/renderer/ai/aiFailure.ts";

describe("assistant failure explanations", () => {
  it("names the provider from its own error", () => {
    expect(providerFrom("Groq returned HTTP 429: Rate limit reached")).toBe("Groq");
    expect(providerFrom("OpenRouter: Provider returned error (code 502)")).toBe("OpenRouter");
    expect(providerFrom("fetch failed")).toBe("The provider");
  });

  it("explains a per-minute rate limit that waiting will fix", () => {
    const failure = describeAiFailure(
      "Groq returned HTTP 429: Rate limit reached for model `qwen/qwen3-32b` in organization `org_1` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Used 5243, Requested 2811. Please try again in 20.54s.",
    );
    expect(failure).toMatchObject({ kind: "rate-limit", title: "Groq rate limit reached", actions: ["retry", "models"] });
    expect(failure.explanation).toContain("per minute");
    expect(failure.detail).toContain("Limit 6000");
  });

  it("says plainly when a request can never fit the plan's limit", () => {
    const failure = describeAiFailure(
      "Groq returned HTTP 429: Rate limit reached on tokens per minute (TPM): Limit 6000, Used 0, Requested 9120.",
    );
    expect(failure.kind).toBe("rate-limit");
    expect(failure.explanation).toContain("waiting will not help");
    expect(failure.actions).toEqual(["new-conversation", "models"]);
  });

  it("treats an oversized request as too large, with the numbers", () => {
    const failure = describeAiFailure(
      "Groq returned HTTP 413: Request too large for model `qwen/qwen3-32b` on tokens per minute (TPM): Limit 6000, Requested 7543, please reduce your message size and try again.",
    );
    expect(failure.kind).toBe("too-large");
    expect(failure.explanation).toContain("6,000");
    expect(failure.explanation).toContain("7,543");
    expect(failure.actions[0]).toBe("new-conversation");
  });

  it("recognises a garbled tool call and suggests trying again", () => {
    const failure = describeAiFailure(
      "Groq: Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details. (code tool_use_failed)",
    );
    expect(failure).toMatchObject({ kind: "tool-format", actions: ["retry", "models"] });
  });

  it("points key, credit, model and tool-support problems at Connect", () => {
    expect(describeAiFailure("OpenAI returned HTTP 401: Incorrect API key provided").kind).toBe("auth");
    expect(describeAiFailure("No API key for Groq. Add one in Connect a model.").kind).toBe("no-key");
    expect(describeAiFailure("OpenRouter returned HTTP 402: Insufficient credits").kind).toBe("credits");
    expect(describeAiFailure("Groq returned HTTP 404: The model `old-model` does not exist").kind).toBe("model-missing");
    expect(describeAiFailure("Ollama returned HTTP 400: llama2 does not support tools").kind).toBe("no-tools");
    for (const text of ["OpenAI returned HTTP 401: Incorrect API key provided", "No API key for Groq. Add one in Connect a model."]) {
      expect(describeAiFailure(text).actions).toEqual(["models"]);
    }
  });

  it("separates network trouble from the provider's own outages", () => {
    expect(describeAiFailure("fetch failed").kind).toBe("network");
    expect(describeAiFailure("connect ECONNREFUSED 127.0.0.1:11434").title).toBe("Could not reach the provider");
    expect(describeAiFailure("Anthropic returned HTTP 529: Overloaded").kind).toBe("server");
  });

  /*
   * The wordings the model fixes of 2026-10-04 introduced or exposed. Each used to land on
   * "The assistant stopped with an error" - or, for the first, on a Continue that could not
   * help.
   */
  it("says a model that only thought should think less or be swapped, not continued", () => {
    const failure = describeAiFailure("The model spent its whole output allowance thinking and wrote nothing. Lower Thinking effort in Connect a model, or choose another model.");
    expect(failure.kind).toBe("thinking-limit");
    expect(failure.actions).toEqual(["models", "retry"]);
  });

  it("recognises OpenRouter's ways of saying a model is unavailable or cannot use tools", () => {
    expect(describeAiFailure("OpenRouter: No endpoints found that support tool use. (code 404)").kind).toBe("no-tools");
    expect(describeAiFailure("OpenRouter: No endpoints found for stealth/space-bunny-alpha. (code 404)").kind).toBe("model-missing");
    expect(describeAiFailure("OpenRouter returned HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 120.").kind).toBe("credits");
  });

  it("stops offering Continue when the output limit stopped the reply twice in a row", () => {
    const failure = describeAiFailure(OUTPUT_LIMIT_AGAIN);
    expect(failure.kind).toBe("output-limit");
    expect(failure.actions).toEqual(["models", "new-conversation"]);
  });

  it("offers a fresh start when Gemini rejects a history it cannot verify", () => {
    const failure = describeAiFailure("Google returned HTTP 400: Function call is missing a thought_signature in functionCall parts. (INVALID_ARGUMENT)");
    expect(failure.kind).toBe("history");
    expect(failure.actions[0]).toBe("new-conversation");
  });

  it("still offers a way forward for anything unrecognised", () => {
    const failure = describeAiFailure("something odd happened");
    expect(failure).toMatchObject({ kind: "unknown", actions: ["retry", "report"], detail: "something odd happened" });
    expect(describeAiFailure("  ").detail).toBe("The assistant stopped without saying why.");
  });
});

/*
 * Reported: after "OpenRouter account is out of credit" the user picked another model, and
 * nothing happened - they had to ask again. Choosing the model was the answer to the card.
 */
describe("picking a failed turn back up after a model switch", () => {
  it("carries on when the provider refused a request it had already been given", () => {
    const failure = describeAiFailure("OpenRouter returned HTTP 402: Insufficient credits. Add more using https://openrouter.ai/settings/credits");
    expect(failure.kind).toBe("credits");
    expect(resumeAfterModelSwitch(failure, "build a todo app")).toBe(CONTINUE_PROMPT);
  });

  it("resends the request itself when no model was connected, since it never reached the conversation", () => {
    const failure = describeAiFailure("No API key for OpenRouter. Add one in Connect a model.");
    expect(failure.kind).toBe("no-key");
    expect(resumeAfterModelSwitch(failure, "build a todo app")).toBe("build a todo app");
    expect(resumeAfterModelSwitch(failure, "   ")).toBeNull();
  });

  it("does nothing for a failure another model would not fix", () => {
    expect(resumeAfterModelSwitch(describeAiFailure("something odd happened"), "build a todo app")).toBeNull();
    expect(resumeAfterModelSwitch(
      describeAiFailure("Google returned HTTP 400: Function call is missing a thought_signature in functionCall parts."),
      "build a todo app",
    )).toBeNull();
  });
});
