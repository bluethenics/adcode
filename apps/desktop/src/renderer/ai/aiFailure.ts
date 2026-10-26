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
import { CONTINUE_PROMPT } from "../../shared/continuePrompt.ts";

export type AiFailureAction = "retry" | "models" | "usage" | "new-conversation" | "report" | "sign-in" | "buy-tokens" | "upgrade-plan";

export interface AiFailure {
  readonly kind:
    | "rate-limit"
    | "daily-limit"
    | "tokens"
    | "too-large"
    | "auth"
    | "sign-in"
    | "no-key"
    | "model-missing"
    | "tool-format"
    | "no-tools"
    | "no-images"
    | "credits"
    | "thinking-limit"
    | "output-limit"
    | "history"
    | "edit-mismatch"
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

/** The main process sends the same words when it keeps a turn going by itself. */
export { CONTINUE_PROMPT };
export const RECOVER_EDIT_PROMPT = "Continue the original request. The previous edit could not match the file. First re-read the affected file using read_file with line_numbers: false and the recovery offset from the tool error. Use the current exact file text to correct old_string, then make the smallest necessary edit and verify it. Do not repeat the failed replacement or rewrite the entire file to bypass the mismatch.";

export function retryAfterFailure(failure: AiFailure, request: string): string {
  if (failure.kind === "edit-mismatch") return RECOVER_EDIT_PROMPT;
  if (failure.kind === "tool-format" && /invalid (?:JSON )?tool arguments|cut off the tool arguments/i.test(failure.detail)) return "Continue the original request from the work already done. The last tool call had invalid arguments and did not run. Read the affected file first. Send one complete JSON tool call at a time with escaped newlines and quotes. Create a minimal complete new file (at most 40 lines), then extend it with small edit_file replacements. Do not repeat the failed full-file call. Verify the finished work.";
  return request;
}

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

  if (/The signed-in account changed\./i.test(detail)) {
    return make("auth", "Your signed-in account changed", "This task stopped when the account changed. Try again to continue with the current account. Work already saved in your project is still there.", ["retry"]);
  }

  if (detail === OUTPUT_LIMIT_AGAIN) {
    return make(
      "output-limit",
      "The reply keeps reaching the model's limit",
      "Continuing did not get it past the limit. Ask for a smaller piece of the work at a time, or pick a model that can write longer replies.",
      ["models", "new-conversation"],
    );
  }
  /*
   * Free AI has no key to get wrong: its 401 and 403 mean the account is not signed in, not
   * verified, banned, or switched off by an administrator. Telling a newcomer their "key" was
   * rejected sent them to Connect a model looking for a key they never had - on their very
   * first message. Signing in fixes the common case, so that is the first button.
   */
  if (who === "Included AI" || /\bincluded AI\b/i.test(detail)) {
    if (/\bbanned\b|code banned/i.test(detail) && !/verify/i.test(detail) && /HTTP 403|code banned/i.test(detail)) return make("auth", "Free AI isn't available for this account", "This account can't use ADCode's free AI. You can still use your own provider key or a model on this computer.", ["models"]);
    if (/disabled for this account|code blocked/i.test(detail)) return make("auth", "Free AI is turned off for this account", "An administrator switched off free AI for this account. Use your own provider key or a local model, or contact the team.", ["models"]);
    if (/verified email|verification link|verification email/i.test(detail)) {
      return make("sign-in", "Verify your email to use free AI", "Open the verification link sent to your account's email, then try again. Check spam if it is missing. Being signed in and having a verified email are separate steps; Google sign-in also verifies the address.", ["retry", "sign-in", "models"]);
    }
    if (/HTTP 40[13]\b|missing-token|invalid-token|verify-account|sign in (?:in account )?to use included AI|sign in and verify/i.test(detail)) {
      return make("sign-in", "Sign in to use free AI", "Free AI needs an ADCode account with a verified email, so it can give you your own free AI credits. Sign in with Google or GitHub - no API key or card - and your message sends again by itself.", ["sign-in", "models"]);
    }
  }
  // Paid tokens (relays from 2026-10-21): the free week on a paid provider's models is spent and nothing is bought.
  if (who === "Included AI" && /free tokens on .+ models\. Buy tokens/i.test(detail)) {
    const refill = /refill in ([^,.]{1,40})/i.exec(detail)?.[1]?.trim();
    return make("tokens", "This week's free Heabsy tokens are used up", `Buy tokens or a plan to keep using Heabsy models now, or switch to Tagflow AI, which stays free. ${refill ? `Your free tokens refill in ${refill}; ` : ""}a task that was running carries on by itself when they do, as long as ADCode stays open.`, ["buy-tokens", "upgrade-plan", "models", "usage"]);
  }
  // Credits (relays from 2026-10-15): the message names the window and when it refills.
  if (who === "Included AI" && /free AI credits/i.test(detail)) {
    if (/set to zero for this account/i.test(detail)) return make("daily-limit", "Free AI credits are off for this account", "An administrator set this account's credits to zero, so waiting will not bring them back. Use your own connected model, or contact the team.", ["models", "usage"]);
    const weekly = /this week's free AI credits/i.test(detail);
    const refill = /refill in ([^,.]{1,40})/i.exec(detail)?.[1]?.trim();
    return make("daily-limit", weekly ? "This week's free AI credits are used up" : "This session's free AI credits are used up", `${refill ? `They refill in ${refill}.` : "They refill when the window ends."} A task that was running carries on by itself then, as long as ADCode stays open. Every free model shares this one balance; your own connected models still work now.`, ["usage", "models"]);
  }
  if (who === "Included AI" && /\bdaily-limit\b|daily included AI allowance/i.test(detail)) {
    if (/cannot fit.*even after a reset/i.test(detail)) return make("daily-limit", "This request exceeds your free AI allowance", "The request is larger than your full daily allowance. Start a smaller conversation, choose another model, or ask an administrator to increase the allowance. A daily reset will not make this request fit.", ["usage", "new-conversation", "models"]);
    // Partner models can have their own allowance; the server names which one ran out.
    const own = /([\w .-]{1,60}?) models have their own daily allowance/i.exec(detail)?.[1]?.trim();
    const except = /except ([\w .-]{1,120}?) models, which have their own/i.exec(detail)?.[1]?.trim();
    const shared = own ? `${own} models have their own daily allowance, so another free model may still have room.`
      : except ? `Free models share this allowance, except ${except} models, which have their own.` : "All free models share this allowance.";
    return make("daily-limit", "Today's free AI allowance cannot cover this request", `Your remaining tokens, AI requests or service budget cannot cover this request and its reply. Check AI usage for your balance and reset time. Wait for the daily reset, or use your own connected model. ${shared}`, ["usage", "models"]);
  }
  if (who === "Included AI" && /\b(?:rate|upstream-rate)-limit\b|HTTP 429/i.test(detail)) {
    if (/per-minute AI request allowance is zero/i.test(detail)) return make("rate-limit", "Included AI requests are disabled", "An administrator set this account's request allowance to zero. Ask them to change the allowance before continuing.", ["usage", "models"]);
    const upstream = /\bupstream-rate-limit\b/i.test(detail);
    return make("rate-limit", upstream ? "This free model is temporarily busy" : "Too many AI requests in a minute", upstream
      ? "The model provider has reached a temporary rate limit. Your free AI credits may still have room. Try again shortly, or choose a different model."
      : "Your account reached its per-minute request limit. Your free AI credits may still have room. Wait about a minute, then try again. Chats and agents on all your devices share this limit.", ["retry", "usage", "models"]);
  }
  if (/invalid JSON tool arguments|invalid tool arguments|cut off the tool arguments/i.test(detail)) {
    return make("tool-format", "The model could not finish an edit", "The failed call did not change your files. Earlier edits are still available below. Try again to continue with smaller edits, or switch model.", ["retry", "models", "report"]);
  }
  if (/old_string was not found|old_string matches \d+ places|identical failed calls to edit_file/i.test(detail)) {
    return make("edit-mismatch", "The model could not match the file text", "The failed edit left the file unchanged. Try again to re-read the current text and make a corrected edit.", ["retry", "models", "report"]);
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
  if (/\bimages-not-supported\b|cannot read image attachments/i.test(detail)) {
    return make("no-images", "This model cannot read images", "Switch to a model that supports images, or start a fresh conversation without image attachments.", ["models", "new-conversation"]);
  }
  // Older included relays combined several unrelated validation failures into one message.
  // Its mention of images does not establish that this request contained an image.
  if (/Choose an offered model and send text within its context limit/i.test(detail)) {
    return make("history", "Included AI rejected this request", "The included model could not accept this request. Try a fresh conversation or switch model. Details contain the server's response.", ["new-conversation", "models", "report"]);
  }
  if (/\binvalid-messages\b/i.test(detail)) {
    return make("history", "This model cannot read this conversation", "Start a fresh conversation with the same request, or choose another model.", ["new-conversation", "models"]);
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
  if (/^terminated$|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up|network|timed? ?out|getaddrinfo/i.test(detail)) {
    return make("network", `Could not reach ${who === "The provider" ? "the provider" : who}`, "Check your internet connection (or that a local model server is running), then try again.", ["retry", "models"]);
  }
  if (/HTTP 5\d\d|overloaded|service unavailable|internal server error|bad gateway|temporarily unavailable/i.test(detail)) {
    return make("server", `${who} is having trouble`, "This is on the provider's side. Try again shortly, or switch to another model.", ["retry", "models"]);
  }
  return make("unknown", "The assistant stopped with an error", "Try again. If it keeps happening, report it - the debug log shows exactly what failed.", ["retry", "report"]);
}

/**
 * What to send once another model is chosen after this failure, or null when another model
 * is not one of its fixes.
 *
 * Reported: after "out of credit" the user picked another model and nothing happened - they
 * had to ask again. Choosing the model was the answer to the card. The provider refused a
 * request that was already recorded, so the new model is asked to carry on, which also keeps
 * any work done before the failure. "No model connected" is the exception: that turn stopped
 * before the request was recorded, so the request itself goes.
 */
export function resumeAfterModelSwitch(failure: AiFailure, request: string): string | null {
  if (!failure.actions.includes("models")) return null;
  if (failure.kind === "no-key") return request.trim().length > 0 ? request : null;
  if (failure.kind === "edit-mismatch") return RECOVER_EDIT_PROMPT;
  return CONTINUE_PROMPT;
}
