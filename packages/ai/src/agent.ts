/**
 * The agent loop.
 *
 * Brief §5.2 calls for "an in-process agent loop with BYO API keys" across four
 * providers, with "the provider... a runtime choice, not a build-time one." This file is
 * the loop; it speaks only the provider-neutral vocabulary in `types.ts`, so swapping
 * providers changes nothing here.
 *
 * §9 governs its failure behaviour: "AI provider down or rate-limited - Chat and
 * completion degrade silently. Editing, terminal, and memory reads are unaffected."
 * Nothing in this file throws to its caller. Every failure becomes an event.
 */
import type {
  AgentEvent,
  Message,
  Provider,
  ProviderRequest,
  StopReason,
  ToolCallBlock,
  ToolDefinition,
  ToolRunner,
} from "./types.ts";

/**
 * How many provider round-trips one `send` may make.
 *
 * A model that keeps calling tools would otherwise loop until the user's key ran out of
 * credit. The bound is generous enough for real multi-step work and finite regardless.
 */
export const MAX_TURNS = 24;

const DEFAULT_MAX_TOKENS = 8192;

const DEFAULT_SYSTEM = [
  "You are the coding assistant built into ADCode, an AI-native IDE.",
  "",
  "Answer with the outcome first, then supporting detail. Match the length of your",
  "response to the question - a direct question gets a direct answer, not a report.",
  "",
  "You have tools for reading and changing this project. Prefer reading the code over",
  "asking about it. Every change you propose is shown to the user as a reviewable diff",
  "before it touches disk, so propose the whole change rather than describing it.",
].join("\n");

export interface AgentDeps {
  readonly provider: Provider;
  readonly model: string;
  readonly tools: readonly ToolDefinition[];
  readonly runner: ToolRunner;
  readonly system?: string;
  readonly maxTokens?: number;
  /** Return a user-facing reason to block this provider request, or null to allow it. */
  readonly beforeRequest?: (request: ProviderRequest) => string | null | Promise<string | null>;
}

/**
 * A deliberately conservative reservation estimate. It includes the maximum possible
 * output, current conversation, system instruction, and tool schemas before a provider
 * request begins. Provider-specific actual usage can later replace the reservation.
 */
export function estimateRequestTokens(request: ProviderRequest): number {
  const context = JSON.stringify({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  });
  return request.maxTokens + Math.ceil(context.length / 3) + 256;
}

export interface Agent {
  send(text: string): AsyncIterable<AgentEvent>;
  cancel(): void;
  history(): readonly Message[];
  reset(): void;
}

export function createAgent(deps: AgentDeps): Agent {
  const messages: Message[] = [];
  const declared = new Set(deps.tools.map((tool) => tool.name));
  let controller: AbortController | null = null;

  async function runTool(call: ToolCallBlock, signal: AbortSignal): Promise<{ content: string; isError: boolean }> {
    // A tool the model invented is not an error worth ending the turn over; tell it
    // plainly and let it choose again.
    if (!declared.has(call.name)) {
      return { content: `No tool named ${JSON.stringify(call.name)} is available.`, isError: true };
    }

    try {
      return await deps.runner.run(call, signal);
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : "tool failed",
        isError: true,
      };
    }
  }

  async function* send(text: string): AsyncIterable<AgentEvent> {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    messages.push({ role: "user", content: [{ type: "text", text }] });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const assistantContent: Array<{ type: "text"; text: string } | ToolCallBlock> = [];
      const pendingCalls: ToolCallBlock[] = [];
      let stop: StopReason = "end-turn";
      let stopDetail: string | undefined;
      let failed = false;

      try {
        const request: ProviderRequest = {
          model: deps.model,
          system: deps.system ?? DEFAULT_SYSTEM,
          messages,
          tools: deps.tools,
          maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
        };
        const blocked = (await deps.beforeRequest?.(request)) ?? null;
        if (blocked !== null) {
          yield { kind: "error", detail: blocked };
          return;
        }
        const stream = deps.provider.stream(request, signal);

        for await (const event of stream) {
          if (signal.aborted) break;

          switch (event.kind) {
            case "text":
              assistantContent.push({ type: "text", text: event.text });
              yield { kind: "text", text: event.text };
              break;

            case "thinking":
              // Deliberately not added to `messages`: a reasoning summary is for the
              // trace widget to display, not context to replay on the next turn.
              yield { kind: "thinking", text: event.text };
              break;

            case "tool-call":
              assistantContent.push(event.call);
              pendingCalls.push(event.call);
              yield { kind: "tool-call", call: event.call };
              break;

            case "stop":
              stop = event.reason;
              stopDetail = event.detail;
              break;
          }
        }
      } catch (error) {
        // §9: the provider being down costs the user an answer, never the editor.
        failed = true;
        yield { kind: "error", detail: error instanceof Error ? error.message : "provider failed" };
      }

      if (assistantContent.length > 0) {
        messages.push({ role: "assistant", content: assistantContent });
      }

      if (signal.aborted) {
        yield { kind: "cancelled" };
        return;
      }

      if (failed) return;

      if (stop === "refusal") {
        yield { kind: "refusal", detail: stopDetail ?? "the model declined this request" };
        return;
      }

      if (pendingCalls.length === 0) {
        yield { kind: "turn-end", reason: stop };
        return;
      }

      // Run every call from this turn, then return all results in one user message -
      // splitting them across messages trains the model out of parallel tool use.
      const results = [];
      for (const call of pendingCalls) {
        const result = await runTool(call, signal);
        results.push({
          type: "tool-result" as const,
          toolCallId: call.id,
          content: result.content,
          isError: result.isError,
        });

        yield {
          kind: "tool-result",
          toolCallId: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError,
        };
      }

      if (signal.aborted) {
        yield { kind: "cancelled" };
        return;
      }

      messages.push({ role: "user", content: results });
    }

    yield { kind: "turn-end", reason: "max-tokens" };
  }

  return {
    send,

    cancel(): void {
      controller?.abort();
    },

    history: () => messages,

    reset(): void {
      controller?.abort();
      messages.length = 0;
    },
  };
}
