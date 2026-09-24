/**
 * Providers that speak the OpenAI `/chat/completions` wire format.
 *
 * Brief §5.2 asks for OpenAI and "a local endpoint (Ollama or compatible)". Ollama
 * exposes an OpenAI-compatible endpoint, so both are this one adapter pointed at
 * different base URLs - and so is any other compatible server a user runs, which is the
 * real value of the shape.
 *
 * Written against `fetch` rather than the OpenAI SDK: taking a second vendor SDK to
 * speak a format this simple would add a dependency to serve one adapter, and the local
 * endpoint is frequently not OpenAI at all.
 */
import type { Provider, ProviderEvent, ProviderId, ProviderRequest, ToolCallBlock } from "../types.ts";

export const OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "o4-mini"] as const;
export const OLLAMA_MODELS = ["qwen2.5-coder", "llama3.1", "deepseek-coder-v2"] as const;

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export interface OpenAiCompatibleDeps {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly string[];
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

/**
 * A provider-side failure, as OpenRouter and friends report it.
 *
 * OpenRouter answers failures as `{"error": {"message", "code"}}` — sometimes
 * with a non-200 status, sometimes as a payload inside an otherwise-200
 * stream. Either way it has no `choices`, so a parser that only reads choices
 * ends the turn with zero text and zero error: the "worked for 5 minutes and
 * said nothing" conversation. Anything this returns is thrown, never skipped.
 */
export function providerErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const text = payload.trim();
    return text.length > 0 ? text.slice(0, 500) : null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as Record<string, unknown>)["error"];
  if (typeof error === "string") {
    const text = error.trim();
    return text.length > 0 ? text.slice(0, 500) : null;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message = typeof record["message"] === "string" ? record["message"].trim() : "";
    const code = record["code"];
    const text = message.length > 0 ? message : JSON.stringify(error).slice(0, 500);
    return typeof code === "string" || typeof code === "number"
      ? `${text} (code ${String(code)})`.slice(0, 500)
      : text.slice(0, 500);
  }
  return null;
}

/** Translate our neutral message shape into the chat-completions one. */
function toWireMessages(request: ProviderRequest): unknown[] {
  const wire: unknown[] = [{ role: "system", content: request.system }];

  for (const message of request.messages) {
    const textParts = message.content.filter((b) => b.type === "text");
    const imageParts = message.content.filter((b) => b.type === "image");
    const toolCalls = message.content.filter((b) => b.type === "tool-call");
    const toolResults = message.content.filter((b) => b.type === "tool-result");

    // Tool results are their own `role: "tool"` messages here, not blocks inside a user
    // turn as in the Anthropic shape.
    for (const result of toolResults) {
      wire.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.isError ? `ERROR: ${result.content}` : result.content,
      });
    }

    if (textParts.length === 0 && toolCalls.length === 0) continue;

    if (message.role === "assistant") {
      wire.push({
        role: "assistant",
        content: textParts.map((b) => b.text).join("") || null,
        ...(toolCalls.length === 0
          ? {}
          : {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }),
      });
    } else if (imageParts.length === 0) {
      wire.push({ role: "user", content: textParts.map((b) => b.text).join("") });
    } else {
      // A multimodal turn: text plus one image part per attachment. Text-only
      // turns keep the plain string shape above, which is what every existing
      // server in the wild already accepts.
      wire.push({
        role: "user",
        content: [
          ...(textParts.length === 0
            ? []
            : [{ type: "text", text: textParts.map((b) => b.text).join("") }]),
          ...imageParts.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mediaType};base64,${image.data}` },
          })),
        ],
      });
    }
  }

  return wire;
}

export function createOpenAiCompatibleProvider(deps: OpenAiCompatibleDeps): Provider {
  const doFetch = deps.fetchImpl ?? fetch;

  return {
    id: deps.id,
    displayName: deps.displayName,
    models: deps.models,

    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      // OpenRouter identifies integrations by referer + title, and keys locked
      // to a referer fail without it. Sent only there — an arbitrary custom
      // endpoint gets nothing beyond the bearer it was given.
      const viaOpenRouter = deps.baseUrl.includes("openrouter.ai");
      const response = await doFetch(`${deps.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          // A local Ollama needs no key; sending an empty bearer would be rejected.
          ...(deps.apiKey.length > 0 ? { authorization: `Bearer ${deps.apiKey}` } : {}),
          ...(viaOpenRouter ? { "HTTP-Referer": "https://adcode.dev", "X-Title": "ADCode" } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          max_tokens: request.maxTokens,
          messages: toWireMessages(request),
          ...(request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
              }),
        }),
      });

      if (!response.ok || response.body === null) {
        // HTTP errors carry the provider's own explanation as JSON ("model not
        // found", "insufficient credits", "does not support tool use"). A bare
        // status leaves the user with nothing to act on.
        let detail = "";
        try {
          const text = (await response.text()).trim().slice(0, 2000);
          if (text.length > 0) {
            try {
              detail = providerErrorMessage(JSON.parse(text) as unknown) ?? text.slice(0, 500);
            } catch {
              detail = text.slice(0, 500);
            }
          }
        } catch {
          // A body that cannot be read has nothing to say.
        }
        throw Object.assign(
          new Error(`${deps.displayName} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`),
          { status: response.status, retryAfter: response.headers.get("retry-after") },
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const pending = new Map<number, ToolCallAccumulator>();

      let buffer = "";
      let finish: string | null = null;
      // Providers holding a request upstream (OpenRouter sends `: OPENROUTER
      // PROCESSING` keepalives while queued) say nothing for minutes. The first
      // comment becomes one waiting note so a long queue reads as waiting, and
      // only the first — a note per keepalive would flood the trace.
      let sawData = false;
      let queueAnnounced = false;

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (line.startsWith(":")) {
            if (!sawData && !queueAnnounced) {
              queueAnnounced = true;
              yield { kind: "thinking", text: "Queued at the provider — waiting for the first token…" };
            }
            continue;
          }
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(payload) as unknown;
          } catch {
            continue;
          }
          if (typeof parsed !== "object" || parsed === null) continue;
          sawData = true;

          const failure = providerErrorMessage(parsed);
          if (failure !== null) {
            throw new Error(`${deps.displayName}: ${failure}`);
          }
          const first = ((parsed as Record<string, unknown>)["choices"] as
            | Array<Record<string, unknown>>
            | undefined)?.[0];
          if (first === undefined) continue;
          const choice = first;

          if (typeof choice["finish_reason"] === "string") finish = choice["finish_reason"];

          const delta = choice["delta"] as Record<string, unknown> | undefined;
          if (delta === undefined) continue;

          if (typeof delta["content"] === "string" && delta["content"].length > 0) {
            yield { kind: "text", text: delta["content"] };
          }

          // Some servers stream a reasoning channel; surface it for the trace widget.
          if (typeof delta["reasoning_content"] === "string" && delta["reasoning_content"].length > 0) {
            yield { kind: "thinking", text: delta["reasoning_content"] };
          }

          const calls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
          for (const call of calls ?? []) {
            const index = typeof call["index"] === "number" ? call["index"] : 0;
            const fn = call["function"] as Record<string, unknown> | undefined;

            const existing = pending.get(index) ?? { id: "", name: "", args: "" };
            if (typeof call["id"] === "string") existing.id = call["id"];
            if (typeof fn?.["name"] === "string") existing.name = fn["name"];
            if (typeof fn?.["arguments"] === "string") existing.args += fn["arguments"];
            pending.set(index, existing);
          }
        }
      }

      for (const accumulator of pending.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = accumulator.args.trim().length === 0
            ? {}
            : (JSON.parse(accumulator.args) as Record<string, unknown>);
        } catch {
          input = {};
        }

        const toolCall: ToolCallBlock = {
          type: "tool-call",
          id: accumulator.id.length > 0 ? accumulator.id : `call_${accumulator.name}`,
          name: accumulator.name,
          input,
        };
        yield { kind: "tool-call", call: toolCall };
      }

      if (signal.aborted) return;

      if (finish === "tool_calls" || pending.size > 0) {
        yield { kind: "stop", reason: "tool-use" };
      } else if (finish === "length") {
        yield { kind: "stop", reason: "max-tokens" };
      } else if (finish === "content_filter") {
        yield { kind: "stop", reason: "refusal", detail: "declined (content filter)" };
      } else {
        yield { kind: "stop", reason: "end-turn" };
      }
    },
  };
}

export const createOpenAiProvider = (apiKey: string, fetchImpl?: typeof fetch): Provider =>
  createOpenAiCompatibleProvider({
    id: "openai",
    displayName: "OpenAI",
    baseUrl: OPENAI_BASE_URL,
    apiKey,
    models: [...OPENAI_MODELS],
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });

/** §5.2's local endpoint. No key: it is the user's own machine. */
export const createOllamaProvider = (baseUrl = OLLAMA_BASE_URL, fetchImpl?: typeof fetch): Provider =>
  createOpenAiCompatibleProvider({
    id: "ollama",
    displayName: "Local (Ollama)",
    baseUrl,
    apiKey: "",
    models: [...OLLAMA_MODELS],
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
