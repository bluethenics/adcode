/**
 * The Google (Gemini) provider.
 *
 * Brief §5.2's fourth provider. Its wire format differs from the other three in ways
 * that matter to the translation: roles are `user`/`model` rather than
 * `user`/`assistant`, the system prompt is its own `systemInstruction` field rather than
 * a message, and tool calls and results are `parts` inside a turn rather than separate
 * messages.
 *
 * Four more things are easy to get wrong, and each broke real chats:
 *
 * - Tool parameters are a subset of OpenAPI 3.0 read into a protobuf. A keyword it has no
 *   field for - `additionalProperties` above all - fails the whole request with a 400, so
 *   schemas are reduced to what Gemini reads (`geminiSchema`).
 * - Gemini 3 attaches a thought signature to its function calls and refuses the next
 *   request if it does not come back on the same part.
 * - Calls carry no id unless Gemini gives one, and two calls to one tool must still be told
 *   apart; the reply to each is matched by the function's name, and its id when it had one.
 * - A failure's explanation is in the body. "HTTP 400" alone is not something anybody can act
 *   on.
 */
import { effortFor } from "../effort.ts";
import type { Provider, ProviderEvent, ProviderRequest, ToolCallBlock, TraitsLookup } from "../types.ts";

export const GOOGLE_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-2.5-pro"] as const;
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GoogleProviderDeps {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** What the catalogue knows about each model: whether it thinks, and at which levels. */
  readonly traits?: TraitsLookup;
}

/** Ids ADCode invented for calls Gemini gave none. */
const LOCAL_ID = "adcode-gemini-";
let localIds = 0;

/**
 * Gemini's own call ids are kept with this mark, and only marked ids go back to Google.
 * A conversation can move between providers, and another provider's ids are not Gemini's
 * to match against.
 */
const GEMINI_ID = "gemini:";

/** The id to send back for a call, or undefined when Gemini did not issue one. */
const geminiId = (id: string): string | undefined => (id.startsWith(GEMINI_ID) ? id.slice(GEMINI_ID.length) : undefined);

/**
 * Google's documented value for a call that has no signature of its own - one another model
 * made before the conversation moved to Gemini 3. It skips the check instead of failing it.
 */
const NO_SIGNATURE = "skip_thought_signature_validator";

/** Gemini 1.x and 2.x predate thought signatures; everything since, and the aliases, use them. */
const usesSignatures = (model: string): boolean => !/gemini-(?:1|2)[.-]/i.test(model);

/** The schema keywords Gemini's function declarations read. Everything else is dropped. */
const SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
  "propertyOrdering",
  "default",
  "items",
  "minimum",
  "maximum",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A JSON Schema reduced to the part Gemini reads.
 *
 * Translations rather than drops where the meaning survives: `const` is a one-value enum,
 * `oneOf` is `anyOf` for every schema a tool here declares, and `["string", "null"]` is a
 * nullable string.
 */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!isRecord(schema)) return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "const") {
      out["type"] ??= typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      out["enum"] = [value];
    } else if (key === "oneOf") {
      out["anyOf"] = geminiSchema(value);
    } else if (key === "type" && Array.isArray(value)) {
      const types = value.filter((one) => one !== "null");
      out["type"] = types[0] ?? "string";
      if (types.length < value.length) out["nullable"] = true;
    } else if (key === "properties" && isRecord(value)) {
      out["properties"] = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, geminiSchema(inner)]));
    } else if (key === "items" || key === "anyOf") {
      out[key] = geminiSchema(value);
    } else if (SCHEMA_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function toContents(request: ProviderRequest): unknown[] {
  // A reply is matched to its call by the function's name, which a result does not carry.
  const callNames = new Map<string, string>();
  for (const message of request.messages) {
    for (const block of message.content) if (block.type === "tool-call") callNames.set(block.id, block.name);
  }
  const signatures = usesSignatures(request.model);

  const contents: unknown[] = [];

  for (const message of request.messages) {
    const parts: unknown[] = [];
    const calls = message.content.filter((block): block is ToolCallBlock => block.type === "tool-call");
    // A message from another model has no signatures at all; its first call carries Google's
    // documented skip value so Gemini 3 accepts the history instead of refusing it.
    const borrowed = signatures && message.role === "assistant" && calls.length > 0 && calls.every((call) => call.signature === undefined);

    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "image") {
        parts.push({ inlineData: { mimeType: block.mediaType, data: block.data } });
      } else if (block.type === "tool-call") {
        const signature = block.signature ?? (borrowed && block === calls[0] ? NO_SIGNATURE : undefined);
        const id = geminiId(block.id);
        parts.push({
          functionCall: { name: block.name, args: block.input, ...(id === undefined ? {} : { id }) },
          ...(signature === undefined ? {} : { thoughtSignature: signature }),
        });
      } else {
        const id = geminiId(block.toolCallId);
        parts.push({
          functionResponse: {
            name: callNames.get(block.toolCallId) ?? block.toolCallId,
            ...(id === undefined ? {} : { id }),
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

/** Google's explanation of a failure, from `{"error": {"message", "status"}}` or plain text. */
function googleError(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    const error = isRecord(parsed) ? parsed["error"] : undefined;
    if (isRecord(error) && typeof error["message"] === "string" && error["message"].trim().length > 0) {
      return typeof error["status"] === "string" ? `${error["message"].trim()} (${error["status"]})` : error["message"].trim();
    }
  } catch {
    // Not JSON: the text itself, trimmed, is the best there is.
  }
  return text.trim().slice(0, 500);
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

      // Thinking settings only for a model the catalogue says thinks: a model that does not
      // rejects them, and one the catalogue does not know is asked plainly.
      const traits = deps.traits?.(request.model);
      const level = traits?.reasoning === true ? effortFor(request.effort, traits.effortLevels) : undefined;
      const thinkingConfig = traits?.reasoning === true
        ? { includeThoughts: true, ...(level === undefined ? {} : { thinkingLevel: level }) }
        : undefined;

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
          generationConfig: {
            maxOutputTokens: request.maxTokens,
            ...(thinkingConfig === undefined ? {} : { thinkingConfig }),
          },
          ...(request.tools.length === 0
            ? {}
            : {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: geminiSchema(tool.inputSchema),
                    })),
                  },
                ],
              }),
        }),
      });

      if (!response.ok || response.body === null) {
        let detail = "";
        try {
          detail = googleError(await response.text());
        } catch {
          // A body that cannot be read has nothing to add.
        }
        throw Object.assign(new Error(`Google returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`), {
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
        });
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

          // A failure part way through arrives as a data line of its own, not as a status.
          if (isRecord(parsed["error"])) throw new Error(`Google: ${googleError(JSON.stringify(parsed))}`);

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
              const signature = typeof part["thoughtSignature"] === "string" ? part["thoughtSignature"] : undefined;
              const call: ToolCallBlock = {
                type: "tool-call",
                id: typeof fn["id"] === "string" && fn["id"].length > 0 ? `${GEMINI_ID}${fn["id"]}` : `${LOCAL_ID}${++localIds}`,
                name: fn["name"],
                input: (fn["args"] as Record<string, unknown> | undefined) ?? {},
                ...(signature === undefined ? {} : { signature }),
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
