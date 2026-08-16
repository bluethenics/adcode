/**
 * The Anthropic provider, on the official SDK.
 *
 * Several things here are easy to get wrong from memory, because the API changed in
 * 2025-26 and the older shapes now hard-fail rather than degrade:
 *
 * - `temperature`, `top_p`, and `top_k` are **removed** on Claude Opus 5 - sending any
 *   of them returns a 400. Steering happens through the prompt.
 * - `thinking: {type: "enabled", budget_tokens: N}` is removed too. Adaptive thinking is
 *   the only on-mode, and it is on by *default* on Opus 5 - omitting `thinking` no
 *   longer means "no thinking".
 * - `thinking.display` defaults to `"omitted"`, which streams thinking blocks whose text
 *   is empty. §5.3's trace widget exists to make the agent legible, so this asks for
 *   `"summarized"` explicitly - with the default it would render a blank panel.
 * - `stop_reason: "refusal"` arrives as a normal HTTP 200 with possibly-empty content.
 *   Reading `content[0]` without checking it first is a crash on a successful response.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderEvent, ProviderRequest, ToolCallBlock } from "../types.ts";

/** Opus 5 is the current flagship; the rest are offered for cost and latency choices. */
export const ANTHROPIC_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
] as const;

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export interface AnthropicProviderDeps {
  readonly apiKey: string;
  /** Injectable for tests; defaults to the SDK's own transport. */
  readonly client?: Anthropic;
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  json: string;
}

export function createAnthropicProvider(deps: AnthropicProviderDeps): Provider {
  const client = deps.client ?? new Anthropic({ apiKey: deps.apiKey });

  return {
    id: "anthropic",
    displayName: "Anthropic",
    models: [...ANTHROPIC_MODELS],

    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const stream = client.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          // Adaptive is the only on-mode, and `summarized` is what makes the trace
          // widget show anything at all.
          thinking: { type: "adaptive", display: "summarized" },
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content.map((block) => {
              if (block.type === "text") return { type: "text" as const, text: block.text };
              if (block.type === "tool-call") {
                return {
                  type: "tool_use" as const,
                  id: block.id,
                  name: block.name,
                  input: block.input,
                };
              }
              return {
                type: "tool_result" as const,
                tool_use_id: block.toolCallId,
                content: block.content,
                is_error: block.isError,
              };
            }),
          })),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
          })),
        },
        { signal },
      );

      const pending = new Map<number, ToolUseAccumulator>();

      for await (const event of stream) {
        if (signal.aborted) return;

        switch (event.type) {
          case "content_block_start": {
            if (event.content_block.type === "tool_use") {
              pending.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
                json: "",
              });
            }
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;

            if (delta.type === "text_delta") {
              yield { kind: "text", text: delta.text };
            } else if (delta.type === "thinking_delta") {
              // Empty under `display: "omitted"`; skip rather than emit blank events.
              if (delta.thinking.length > 0) yield { kind: "thinking", text: delta.thinking };
            } else if (delta.type === "input_json_delta") {
              const accumulator = pending.get(event.index);
              if (accumulator) accumulator.json += delta.partial_json;
            }
            break;
          }

          case "content_block_stop": {
            const accumulator = pending.get(event.index);
            if (accumulator === undefined) break;
            pending.delete(event.index);

            let input: Record<string, unknown> = {};
            try {
              // The arguments arrive as streamed JSON fragments; an empty body is a
              // no-argument call, not a malformed one.
              input = accumulator.json.trim().length === 0
                ? {}
                : (JSON.parse(accumulator.json) as Record<string, unknown>);
            } catch {
              input = {};
            }

            const call: ToolCallBlock = {
              type: "tool-call",
              id: accumulator.id,
              name: accumulator.name,
              input,
            };
            yield { kind: "tool-call", call };
            break;
          }

          default:
            break;
        }
      }

      const final = await stream.finalMessage();

      switch (final.stop_reason) {
        case "tool_use":
          yield { kind: "stop", reason: "tool-use" };
          break;
        case "max_tokens":
          yield { kind: "stop", reason: "max-tokens" };
          break;
        case "refusal": {
          // A refusal is a successful response whose content may be empty. Reporting it
          // as an outcome - not an exception - is what lets the chat widget say so.
          const category =
            typeof final.stop_details === "object" && final.stop_details !== null
              ? String((final.stop_details as { category?: unknown }).category ?? "unspecified")
              : "unspecified";
          yield { kind: "stop", reason: "refusal", detail: `declined (${category})` };
          break;
        }
        default:
          yield { kind: "stop", reason: "end-turn" };
      }
    },
  };
}
