/**
 * The Google (Gemini) provider.
 *
 * Brief §5.2's fourth provider. Its wire format differs from the other three in ways
 * that matter to the translation: roles are `user`/`model` rather than
 * `user`/`assistant`, the system prompt is its own `systemInstruction` field rather than
 * a message, and tool calls and results are `parts` inside a turn rather than separate
 * messages.
 */
import type { Provider, ProviderEvent, ProviderRequest, ToolCallBlock } from "../types.ts";

export const GOOGLE_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GoogleProviderDeps {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function toContents(request: ProviderRequest): unknown[] {
  const contents: unknown[] = [];

  for (const message of request.messages) {
    const parts: unknown[] = [];

    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "tool-call") {
        parts.push({ functionCall: { name: block.name, args: block.input } });
      } else {
        parts.push({
          functionResponse: {
            name: block.toolCallId,
            response: block.isError ? { error: block.content } : { result: block.content },
          },
        });
      }
    }

    if (parts.length === 0) continue;
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }

  return contents;
}

export function createGoogleProvider(deps: GoogleProviderDeps): Provider {
  const doFetch = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl ?? GOOGLE_BASE_URL;

  return {
    id: "google",
    displayName: "Google",
    models: [...GOOGLE_MODELS],

    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const url = `${baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

      const response = await doFetch(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          // Header rather than a query parameter: a key in a URL ends up in logs.
          "x-goog-api-key": deps.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: toContents(request),
          generationConfig: { maxOutputTokens: request.maxTokens },
          ...(request.tools.length === 0
            ? {}
            : {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    })),
                  },
                ],
              }),
        }),
      });

      if (!response.ok || response.body === null) {
        throw new Error(`Google returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let sawToolCall = false;
      let finish: string | null = null;

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (!line.startsWith("data:")) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }

          const candidate = (parsed["candidates"] as Array<Record<string, unknown>> | undefined)?.[0];
          if (candidate === undefined) continue;

          if (typeof candidate["finishReason"] === "string") finish = candidate["finishReason"];

          const content = candidate["content"] as Record<string, unknown> | undefined;
          for (const part of (content?.["parts"] as Array<Record<string, unknown>> | undefined) ?? []) {
            if (typeof part["text"] === "string" && part["text"].length > 0) {
              // Gemini marks reasoning parts with `thought`; route them to the trace.
              if (part["thought"] === true) yield { kind: "thinking", text: part["text"] };
              else yield { kind: "text", text: part["text"] };
            }

            const fn = part["functionCall"] as Record<string, unknown> | undefined;
            if (fn !== undefined && typeof fn["name"] === "string") {
              sawToolCall = true;
              const call: ToolCallBlock = {
                type: "tool-call",
                // Gemini does not issue call ids; the name is the correlation key its
                // own functionResponse shape uses, so mirror that.
                id: fn["name"],
                name: fn["name"],
                input: (fn["args"] as Record<string, unknown> | undefined) ?? {},
              };
              yield { kind: "tool-call", call };
            }
          }
        }
      }

      if (signal.aborted) return;

      if (sawToolCall) yield { kind: "stop", reason: "tool-use" };
      else if (finish === "MAX_TOKENS") yield { kind: "stop", reason: "max-tokens" };
      else if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
        yield { kind: "stop", reason: "refusal", detail: `declined (${finish.toLowerCase()})` };
      } else yield { kind: "stop", reason: "end-turn" };
    },
  };
}
