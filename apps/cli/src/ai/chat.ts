import type { Effort, Message, ProviderEvent } from "../../../../packages/ai/src/index.ts";
import type { BuiltProvider } from "./provider.ts";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface StreamResult {
  readonly text: string;
  readonly thinking: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly stopReason: string;
  readonly refused: boolean;
  readonly cutOff: boolean;
}

export interface StreamHandlers {
  readonly onText?: (delta: string) => void;
  readonly onThinking?: (delta: string) => void;
  readonly onStatus?: (text: string) => void;
}

const DEFAULT_MAX_TOKENS = 8_192;

export function systemPrompt(cwd: string): string {
  return [
    "You are ADCode, a terminal coding assistant inside the ADCode product.",
    "Answer the person at the keyboard directly and concisely. Use Markdown, fenced code blocks and short paragraphs.",
    "You are running in a terminal, so prefer narrow code blocks and avoid huge tables.",
    "You cannot edit files from this surface. If a change needs the editor, say which file and what to change.",
    `The current working directory is ${cwd}.`,
    "Never invent command output or claim to have run something you did not run.",
  ].join("\n");
}

export function toMessages(turns: readonly ChatTurn[]): Message[] {
  return turns.map((turn) => ({
    role: turn.role,
    content: [{ type: "text", text: turn.text }],
  }));
}

export function maxTokensFor(model: { readonly maxOutput: number }): number {
  return Math.max(256, Math.min(DEFAULT_MAX_TOKENS, model.maxOutput || DEFAULT_MAX_TOKENS));
}

export function effortFor(desktopEffort: Effort | "auto"): Effort | undefined {
  return desktopEffort === "auto" ? undefined : desktopEffort;
}

export async function streamChat(options: {
  readonly built: BuiltProvider;
  readonly turns: readonly ChatTurn[];
  readonly signal: AbortSignal;
  readonly system?: string;
  readonly cwd?: string;
  readonly maxTokens?: number;
  readonly effort?: Effort | "auto";
  readonly handlers?: StreamHandlers;
}): Promise<StreamResult> {
  const { built, signal, handlers } = options;
  const effort = effortFor(options.effort ?? "auto");
  const request = {
    model: built.selection.modelId,
    system: options.system ?? systemPrompt(options.cwd ?? process.cwd()),
    messages: toMessages(options.turns),
    tools: [],
    maxTokens: options.maxTokens ?? maxTokensFor(built.model),
    ...(effort === undefined ? {} : { effort }),
  };

  let text = "";
  let thinking = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let stopReason = "end-turn";
  let refused = false;
  let cutOff = false;

  for await (const event of built.provider.stream(request, signal) as AsyncIterable<ProviderEvent>) {
    if (signal.aborted) {
      stopReason = "cancelled";
      break;
    }
    switch (event.kind) {
      case "text":
        text += event.text;
        handlers?.onText?.(event.text);
        break;
      case "thinking":
        thinking += event.text;
        handlers?.onThinking?.(event.text);
        break;
      case "status":
        handlers?.onStatus?.(event.text);
        break;
      case "usage":
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        break;
      case "stop":
        stopReason = event.reason;
        refused = event.reason === "refusal";
        cutOff = event.reason === "max-tokens";
        break;
      default:
        // Tool events cannot occur: the CLI sends no tools. Ignoring them keeps a future
        // provider adapter from turning an unexpected event into a failed reply.
        break;
    }
  }

  return { text, thinking, inputTokens, outputTokens, stopReason, refused, cutOff };
}

/** A provider failure as a sentence somebody can act on. */
export function describeChatError(error: unknown, selection?: { providerId: string; ready: boolean; reason: string | null }): string {
  const message = error instanceof Error ? error.message : String(error);
  // Included AI explains a spent daily allowance itself: how much is left, when it refills,
  // and which model is free. That beats any generic sentence, so pass it through.
  if (/daily-limit|credits left|out of credits|not enough credits/i.test(message)) {
    const server = message.replace(/^.*?returned HTTP \d{3}:\s*/s, "").replace(/\s*\(code [\w-]+\)\s*$/, "").trim();
    if (server.length > 0) return server;
  }
  if (/verify|verified|verification/i.test(message)) {
    return "Included AI needs a verified account. Open ADCode Desktop and verify the email on the signed-in account, then send the message again.";
  }
  if (/401|unauthor|invalid.*key/i.test(message)) return "The provider rejected the credential. Check the key or sign in again.";
  if (/403|forbidden/i.test(message)) return "The provider refused this account. Included AI may need a verified email.";
  if (/\b429\b|rate[ -]?limit|too many requests|quota/i.test(message)) return "The provider is rate-limiting this account. Wait a moment and try again.";
  if (/fetch failed|ECONN|ENOTFOUND|network|timed out|timeout/i.test(message)) {
    return "The model could not be reached. Check the connection and try again.";
  }
  if (/signed-in account|sign in/i.test(message)) return message;
  if (selection !== undefined && !selection.ready && selection.reason !== null) return selection.reason;
  return message.length > 0 ? message : "The model stopped without an answer.";
}
