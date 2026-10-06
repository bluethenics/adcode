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
import { effortFor } from "../effort.ts";
import { allowedOutputSize } from "../outputSize.ts";
import type { Provider, ProviderEvent, ProviderRequest, ToolCallBlock, TraitsLookup } from "../types.ts";

/**
 * What a Claude model accepts, by generation.
 *
 * - Adaptive thinking and `output_config.effort` (without a beta header) arrived with 4.6.
 *   Sending either to Haiku 4.5, Sonnet 4.5 or Opus 4.5 is a 400, which is how the cheap,
 *   fast Claude failed every message.
 * - `thinking.display` arrived with 4.7, when the default became "omitted"; 4.6 already
 *   summarises.
 * - A Claude newer than this code is treated as the newest kind.
 */
export function claudeThinking(model: string): { readonly adaptive: boolean; readonly display: boolean } {
  const named = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d{1,2}))?(?=$|[-@])/i.exec(model);
  if (named === null) return { adaptive: false, display: false };
  if (/^(?:fable|mythos)$/i.test(named[1]!)) return { adaptive: true, display: true };
  const version = Number(named[2]) + Number(named[3] ?? 0) / 10;
  return { adaptive: version >= 4.6, display: version >= 4.7 };
}

/** Levels every adaptive Claude accepts, for a model the catalogue does not describe. */
const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/** Opus 5.5 is the current flagship; the rest are offered for cost and latency choices. */
export const ANTHROPIC_MODELS = [
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
] as const;

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export interface AnthropicProviderDeps {
  readonly apiKey: string;
  /** Injectable for tests; defaults to the SDK's own transport. */
  readonly client?: Anthropic;
  /** What the catalogue knows about each model: the effort levels it lists, above all. */
  readonly traits?: TraitsLookup;
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  json: string;
}

type ClaudeStream = ReturnType<Anthropic["messages"]["stream"]>;

/**
 * One streamed reply, as provider events. `reading.started` turns true on the first event,
 * which is how the caller tells a refusal before any output from a failure part way through.
 */
async function* readStream(stream: ClaudeStream, signal: AbortSignal, reading: { started: boolean }): AsyncIterable<ProviderEvent> {
  const pending = new Map<number, ToolUseAccumulator>();

  for await (const event of stream) {
    reading.started = true;
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
        let inputError: string | undefined;
        try {
          // The arguments arrive as streamed JSON fragments; an empty body is a
          // no-argument call, not a malformed one.
          input = accumulator.json.trim().length === 0
            ? {}
            : (JSON.parse(accumulator.json) as Record<string, unknown>);
        } catch {
          // Running the tool with nothing would report a missing path; the model needs to
          // hear that its arguments did not parse.
          input = {};
          inputError = "Tool not run: the tool arguments were not valid JSON. Retry with one smaller call whose arguments match the tool schema.";
        }

        const call: ToolCallBlock = {
          type: "tool-call",
          id: accumulator.id,
          name: accumulator.name,
          input,
          ...(inputError === undefined ? {} : { inputError }),
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
}

export function createAnthropicProvider(deps: AnthropicProviderDeps): Provider {
  const client = deps.client ?? new Anthropic({ apiKey: deps.apiKey, maxRetries: 0 });

  return {
    id: "anthropic",
    displayName: "Anthropic",
    models: [...ANTHROPIC_MODELS],

    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const supports = claudeThinking(request.model);
      // Effort rides on output_config, only when the user picked one, only for a model that
      // takes it, and at a level that model has.
      const effort = supports.adaptive
        ? effortFor(request.effort, deps.traits?.(request.model)?.effortLevels ?? CLAUDE_LEVELS)
        : undefined;
      const params = (size: number) => ({
        model: request.model,
        max_tokens: size,
        system: request.system,
        // Adaptive is the only on-mode, and on 4.7 and later `summarized` is what makes the
        // trace widget show anything at all. Older models are asked plainly.
        ...(supports.adaptive
          ? { thinking: supports.display ? { type: "adaptive" as const, display: "summarized" as const } : { type: "adaptive" as const } }
          : {}),
        ...(effort === undefined ? {} : { output_config: { effort: effort as "low" | "medium" | "high" | "max" } }),
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => {
            if (block.type === "text") return { type: "text" as const, text: block.text };
            // Images arrive on the user turn that attached them, or after the tool
            // results of the step that took them; the agent loop retires older ones.
            if (block.type === "image") {
              return {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: block.mediaType,
                  data: block.data,
                },
              };
            }
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
      });

      // A model whose output cap is below the request answers "max_tokens: 16384 > 8192"
      // before streaming a thing; it is asked once more, at the size it names.
      let size = request.maxTokens;
      for (let attempt = 0; ; attempt++) {
        const reading = { started: false };
        try {
          yield* readStream(client.messages.stream(params(size), { signal }), signal, reading);
          return;
        } catch (error) {
          const allowed = !reading.started && attempt === 0 && !signal.aborted
            ? allowedOutputSize(error instanceof Error ? error.message : String(error))
            : null;
          if (allowed === null || allowed < 256 || allowed >= size) throw error;
          size = allowed;
        }
      }
    },
  };
}
