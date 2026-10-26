import { describe, expect, it } from "vitest";

it("offers retry with the current account after an account switch", () => {
  const failure = describeAiFailure("The signed-in account changed. Start this task again with the current account.");
  expect(failure.title).toBe("Your signed-in account changed");
  expect(failure.actions).toEqual(["retry"]);
  expect(failure.explanation).toContain("current account");
});

it("distinguishes verification from being signed out and allows checking again", () => {
  const failure = describeAiFailure("Included AI returned HTTP 403: Free AI needs a verified email. Open the verification link we emailed to your address. (code verify-account)");
  expect(failure.title).toBe("Verify your email to use free AI");
  expect(failure.actions).toContain("retry");
  expect(failure.explanation).toContain("separate steps");
  expect(describeAiFailure("terminated").kind).toBe("network");
});
import { CONTINUE_PROMPT, RECOVER_EDIT_PROMPT, describeAiFailure, OUTPUT_LIMIT_AGAIN, providerFrom, resumeAfterModelSwitch, retryAfterFailure } from "../src/renderer/ai/aiFailure.ts";

it("explains invalid file arguments and retries the remaining work in smaller edits", () => {
  const failure = describeAiFailure("Stopped after three identical failed calls to propose_edit. Tool not run: the provider returned invalid JSON tool arguments.");
  expect(failure).toMatchObject({ kind: "tool-format", title: "The model could not finish an edit", actions: ["retry", "models", "report"] });
  expect(retryAfterFailure(failure, "original prompt")).toMatch(/at most 40 lines/);
  expect(failure.explanation).toMatch(/Earlier edits/);
});

describe("assistant failure explanations", () => {
  it("asks a signed-out newcomer to sign in for free AI instead of blaming a key they never had", () => {
    for (const raw of [
      "Included AI returned HTTP 401: Sign in to use included AI. Banned accounts cannot use it. (code missing-token)",
      "Included AI returned HTTP 403: Sign in and verify your email in Account to use included AI. No API key is needed. (code verify-account)",
      "Included AI: Sign in in Account to use included AI.",
    ]) {
      const failure = describeAiFailure(raw);
      expect(failure, raw).toMatchObject({ kind: "sign-in", title: "Sign in to use free AI", actions: ["sign-in", "models"] });
      expect(failure.explanation).not.toMatch(/key (?:may be|was) /i);
    }
    expect(describeAiFailure("Included AI returned HTTP 403: Sign in to use included AI. Banned accounts cannot use it. (code banned)")).toMatchObject({ kind: "auth", title: "Free AI isn't available for this account" });
    expect(describeAiFailure("Included AI returned HTTP 403: Included AI is disabled for this account. (code blocked)")).toMatchObject({ kind: "auth", title: "Free AI is turned off for this account" });
    // A personal key's refusal still points at the key.
    expect(describeAiFailure("OpenAI returned HTTP 401: Incorrect API key provided")).toMatchObject({ kind: "auth", title: "OpenAI did not accept your key" });
  });
  it("separates a daily allowance from a temporary limit and offers its usage display", () => {
    const daily = describeAiFailure("Included AI returned HTTP 429: Your daily included AI allowance cannot cover this request. (code daily-limit)");
    expect(daily).toMatchObject({ kind: "daily-limit", actions: ["usage", "models"] });
    expect(daily.explanation).toContain("daily reset");
    expect(daily.explanation).toContain("All free models share this allowance");
    expect(daily.explanation).not.toContain("in a minute");
    const partner = describeAiFailure("Included AI returned HTTP 429: Your remaining daily included AI allowance cannot cover this request and its reply. This task can resume after the daily reset. Heabsy models have their own daily allowance, so other free models may still have room. (code daily-limit)");
    expect(partner.explanation).toContain("Heabsy models have their own daily allowance, so another free model may still have room.");
    const main = describeAiFailure("Included AI returned HTTP 429: Your remaining daily included AI allowance cannot cover this request and its reply. Free models share this allowance, except Heabsy models, which have their own. (code daily-limit)");
    expect(main.explanation).toContain("except Heabsy models, which have their own");
    const minute = describeAiFailure("Included AI returned HTTP 429: Included AI is busy for this account. (code rate-limit)");
    expect(minute).toMatchObject({ kind: "rate-limit", title: "Too many AI requests in a minute", actions: ["retry", "usage", "models"] });
    expect(minute.explanation).toContain("free AI credits may still have room");
    const session = describeAiFailure("Included AI returned HTTP 429: You've used this 5-hour window's free AI credits (2,000). They refill in 3 hr 12 min, and this task resumes by itself then. All free models share one credit balance. (code daily-limit)");
    expect(session).toMatchObject({ kind: "daily-limit", title: "This session's free AI credits are used up", actions: ["usage", "models"] });
    expect(session.explanation).toContain("They refill in 3 hr 12 min.");
    const week = describeAiFailure("Included AI returned HTTP 429: You've used this week's free AI credits (20,000). They refill in 2 days 3 hr, and this task resumes by itself then. (code daily-limit)");
    expect(week.title).toBe("This week's free AI credits are used up");
    expect(week.explanation).toContain("They refill in 2 days 3 hr.");
    expect(describeAiFailure("Included AI returned HTTP 429: Free AI credits are set to zero for this account, so waiting will not help. (code daily-limit)").title).toBe("Free AI credits are off for this account");
    const upstream = describeAiFailure("Included AI returned HTTP 429: Busy (code upstream-rate-limit)");
    expect(upstream.title).toBe("This free model is temporarily busy");
    expect(upstream.explanation).toContain("model provider");
  });
  it("does not promise that a reset will fix an undersized or disabled allowance",()=>{
    const tooSmall=describeAiFailure("Included AI returned HTTP 429: This request cannot fit within your account's daily allowance, even after a reset. (code daily-limit)");
    expect(tooSmall.actions).toEqual(["usage","new-conversation","models"]);
    expect(tooSmall.explanation).toContain("reset will not make this request fit");
    const disabled=describeAiFailure("Included AI returned HTTP 429: This account's per-minute AI request allowance is zero. (code rate-limit)");
    expect(disabled.title).toBe("Included AI requests are disabled");expect(disabled.actions).not.toContain("retry");
  });
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
  it("identifies the Linux edit loop and makes retry reread exact file text", () => {
    const failure = describeAiFailure("Stopped after three identical failed calls to edit_file. Edit 1's old_string was not found in src/crawler/crawler.ts. Nothing was changed.");
    expect(failure).toMatchObject({ kind: "edit-mismatch", actions: ["retry", "models", "report"] });
    expect(retryAfterFailure(failure, "fix the crawler")).toBe(RECOVER_EDIT_PROMPT);
    expect(RECOVER_EDIT_PROMPT).toContain("line_numbers: false");
    expect(retryAfterFailure(describeAiFailure("fetch failed"), "fix the crawler")).toBe("fix the crawler");
  });
  it("offers actionable recovery for the older ambiguous included-AI rejection", () => {
    const failure = describeAiFailure("Included AI returned HTTP 400: Choose an offered model and send text within its context limit. Image attachments are not supported by included AI. (code bad-request)");
    expect(failure).toMatchObject({ kind: "history", title: "Included AI rejected this request", actions: ["new-conversation", "models", "report"] });
    expect(failure.explanation).not.toContain("cannot read images");
  });
  it("distinguishes included-AI image, model, message format and context failures", () => {
    expect(describeAiFailure("Included AI returned HTTP 400: Included AI cannot read image attachments. (code images-not-supported)")).toMatchObject({ kind: "no-images", actions: ["models", "new-conversation"] });
    expect(describeAiFailure("Included AI returned HTTP 400: This model is not available in included AI. (code model-unavailable)").kind).toBe("model-missing");
    expect(describeAiFailure("Included AI returned HTTP 400: Invalid conversation (code invalid-messages)").kind).toBe("history");
    expect(describeAiFailure("Included AI returned HTTP 413: Estimated input tokens: Limit 32768, Requested 35000. (code context-length)")).toMatchObject({ kind: "too-large" });
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

describe("the paid-token limit", () => {
  it("offers to buy tokens or switch models when the free Heabsy week is used up", () => {
    const failure = describeAiFailure("Included AI returned HTTP 429: You've used this week's 10,000,000 free tokens on Heabsy models. Buy tokens at https://adcode.bluethenics.com/ai-tokens, or switch to Tagflow AI, which stays free. Your free tokens refill in 3 days. (code daily-limit)");
    expect(failure.kind).toBe("tokens");
    expect(failure.title).toBe("This week's free Heabsy tokens are used up");
    expect(failure.actions).toEqual(["buy-tokens", "upgrade-plan", "models", "usage"]);
    expect(failure.explanation).toContain("Buy tokens or a plan");
    expect(failure.explanation).toContain("3 days");
  });
});
