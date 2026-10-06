/**
 * What went wrong with an assistant turn, in words a person can act on.
 *
 * The provider's own message is precise but written for its engineers ("HTTP 429: Rate
 * limit reached for model ... in organization ... on tokens per minute (TPM): Limit 6000,
 * Used 4210, Requested 3170"). Shown alone it reads as noise; hidden, as it was, the chat
 * just said "Failed after 34s" and the user had nothing to go on. This turns it into a
 * title, one or two sentences, and the actions that can actually fix it - and the card
 * still shows the exact message underneath for anyone who wants it.
 *
 * Pure: no DOM, so every rule is tested against real provider wording.
 */

export type AiFailureAction = "retry" | "models" | "new-conversation" | "report";

export interface AiFailure {
  readonly kind:
    | "rate-limit"
    | "too-large"
    | "auth"
    | "no-key"
    | "model-missing"
    | "tool-format"
    | "no-tools"
    | "credits"
    | "thinking-limit"
    | "output-limit"
    | "history"
    | "network"
    | "server"
    | "unknown";
  readonly title: string;
  readonly explanation: string;
  readonly actions: readonly AiFailureAction[];
  /** The provider's exact words, for the details disclosure and the debug log. */
  readonly detail: string;
}

/**
 * What the chat reports when the output limit stopped a reply a second time in a row.
 *
 * Reported: Vibe answered "I stopped at a limit... Continue" again and again, and Continue
 * changed nothing. The agent now continues a cut-off reply by itself, with more room each
 * time; a reply that still reaches the limit after that will not be fixed by one more
 * Continue, so the chat says what will.
 */
export const OUTPUT_LIMIT_AGAIN =
  "The reply reached the model's output limit again, even after continuing.";

/** "Groq returned HTTP 429: ..." -> "Groq". Falls back to a neutral noun. */
export function providerFrom(detail: string): string {
  // A display name is capitalised and followed by ": " - which keeps "connect ECONNREFUSED
  // 127.0.0.1:11434" from being mistaken for a provider called "connect ECONNREFUSED 127".
  const named = /^([A-Z][\w .()-]{0,40}?)(?: returned HTTP|: )/.exec(detail.trim());
  return named?.[1]?.trim() || "The provider";
}

/** "Limit 6000, Used 4210, Requested 3170" -> the numbers, when a provider states them. */
function tokenNumbers(detail: string): { limit: number; requested: number } | null {
  const limit = /\blimit\s*:?\s*(\d[\d,]*)/i.exec(detail);
  const requested = /\brequested\s*:?\s*(\d[\d,]*)/i.exec(detail);
  if (limit?.[1] === undefined || requested?.[1] === undefined) return null;
  return { limit: Number(limit[1].replace(/,/g, "")), requested: Number(requested[1].replace(/,/g, "")) };
}

export function describeAiFailure(raw: string): AiFailure {
  const detail = raw.trim() || "The assistant stopped without saying why.";
  const who = providerFrom(detail);
  const make = (kind: AiFailure["kind"], title: string, explanation: string, actions: readonly AiFailureAction[]): AiFailure =>
    ({ kind, title, explanation, actions, detail });

  if (detail === OUTPUT_LIMIT_AGAIN) {
    return make(
      "output-limit",
      "The reply keeps reaching the model's limit",
      "Continuing did not get it past the limit. Ask for a smaller piece of the work at a time, or pick a model that can write longer replies.",
      ["models", "new-conversation"],
    );
  }
  // Before "Connect a model" below: this one names Connect as the fix, not as what is missing.
  if (/output allowance thinking/i.test(detail)) {
    return make(
      "thinking-limit",
      "The model only thought, and wrote nothing",
      "It spent its whole output allowance reasoning, even with more room. Lower Thinking effort in Connect a model, or pick a model that answers sooner.",
      ["models", "retry"],
    );
  }
  if (/No API key|No address for the custom endpoint|Connect a model/i.test(detail)) {
    return make("no-key", "No model connected", "Add a provider and key in Connect a model - it takes about a minute.", ["models"]);
  }
  if (/thought_signature|thought signature|thinking block.*(?:signature|bound)|Invalid `?signature`?/i.test(detail)) {
    return make(
      "history",
      "This model cannot pick up this conversation",
      `${who} refused the conversation's earlier steps. Start a fresh conversation with the same request - nothing in your project is lost.`,
      ["new-conversation", "retry"],
    );
  }
  if (/HTTP 413|request too large|context[_ ]length|maximum context|too many tokens|prompt is too long|reduce the length/i.test(detail)) {
    const numbers = tokenNumbers(detail);
    return make(
      "too-large",
      "This conversation is too big for the model",
      numbers === null
        ? `${who} refused a request this large. Start a new conversation to send less history, or choose a model with a larger context window.`
        : `${who} allows ${numbers.limit.toLocaleString()} tokens here and this request needed ${numbers.requested.toLocaleString()}. Start a new conversation to send less history, or choose a model with a higher limit.`,
      ["new-conversation", "models", "retry"],
    );
  }
  if (/HTTP 429|rate[_ ]limit|too many requests|tokens per (minute|day)|requests per (minute|day)|\bTPM\b|\bRPM\b/i.test(detail)) {
    const numbers = tokenNumbers(detail);
    const perMinute = /per minute|TPM|RPM/i.test(detail);
    return make(
      "rate-limit",
      `${who} rate limit reached`,
      numbers !== null && numbers.requested > numbers.limit
        ? `This request needs ${numbers.requested.toLocaleString()} tokens but your ${who} plan allows ${numbers.limit.toLocaleString()} per minute, so waiting will not help. Start a new conversation to send less, or choose a model with a higher limit.`
        : `${who} is limiting how much you can send${perMinute ? " per minute" : ""}. ADCode already waited and retried. Try again in a minute, or switch to a model with a higher limit.`,
      numbers !== null && numbers.requested > numbers.limit ? ["new-conversation", "models"] : ["retry", "models"],
    );
  }
  if (/HTTP 40[13]\b|invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed|authentication|permission denied|forbidden/i.test(detail)) {
    return make("auth", `${who} did not accept your key`, "The key may be mistyped, revoked, or missing access to this model. Check it in Connect a model.", ["models"]);
  }
  if (/insufficient[_ ](credit|quota|balance)|credit|billing|payment required|HTTP 402|quota (?:is )?(?:reached|exceeded)|exceeded your (?:current )?quota/i.test(detail)) {
    return make("credits", `${who} account is out of credit`, "Add credit with the provider, or switch to another model in Connect a model.", ["models"]);
  }
  if (/does not support tools|tool use is not supported|tools are not supported|function calling is not supported|not support function|endpoints found that support tool/i.test(detail)) {
    return make("no-tools", "This model cannot use tools", "ADCode needs tool use to read and change your files. Choose a model that supports tools.", ["models"]);
  }
  if (/tool_use_failed|failed to call a function|invalid tool call|malformed (?:tool|function)|failed_generation|tool call validation/i.test(detail)) {
    return make(
      "tool-format",
      "The model sent a broken tool call",
      `Some models on ${who} garble tool calls now and then. Try again - it usually works - or choose a model known for reliable tool use.`,
      ["retry", "models"],
    );
  }
  if (/HTTP 404|model[^.]{0,40}(not found|does not exist|not available|decommissioned|deprecated)|unknown model|no such model|No endpoints found for|\(code 404\)/i.test(detail)) {
    return make("model-missing", "This model is not available", `${who} does not offer this model any more, or not to your account. Pick another one in Connect a model.`, ["models"]);
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up|network|timed? ?out|getaddrinfo/i.test(detail)) {
    return make("network", `Could not reach ${who === "The provider" ? "the provider" : who}`, "Check your internet connection (or that a local model server is running), then try again.", ["retry", "models"]);
  }
  if (/HTTP 5\d\d|overloaded|service unavailable|internal server error|bad gateway|temporarily unavailable/i.test(detail)) {
    return make("server", `${who} is having trouble`, "This is on the provider's side. Try again shortly, or switch to another model.", ["retry", "models"]);
  }
  return make("unknown", "The assistant stopped with an error", "Try again. If it keeps happening, report it - the debug log shows exactly what failed.", ["retry", "report"]);
}
