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
 *
 * "Compatible" covers less than the name suggests, and each gap broke real chats. The
 * differences live in one table, `profileFor`, rather than in ifs scattered through the
 * request: OpenAI's own reasoning models refuse `max_tokens`; OpenRouter reads effort as
 * `reasoning.effort` and needs its `reasoning_details` back during a tool loop; DeepSeek's
 * thinking mode needs `reasoning_content` back the same way. Which effort levels a model
 * accepts is a fact about the model, so it comes from the catalogue (`traits`), never a guess.
 */
import { effortFor } from "../effort.ts";
import { allowedOutputSize } from "../outputSize.ts";
import { createFencedCallFilter, localToolCalls } from "./localToolCalls.ts";
import { parseToolArguments } from "./toolArguments.ts";
import type {
  Provider,
  ProviderEvent,
  ProviderId,
  ProviderReasoning,
  ProviderRequest,
  ToolCallBlock,
  TraitsLookup,
} from "../types.ts";

export const OPENAI_MODELS = ["gpt-6-astra", "gpt-5.6", "gpt-5-mini"] as const;
export const OLLAMA_MODELS = ["qwen3-coder:30b", "qwen3.6:27b", "deepseek-coder-v2:16b"] as const;

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export interface OpenAiCompatibleDeps {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly string[];
  /** What the catalogue knows about each model: its effort levels above all. */
  readonly traits?: TraitsLookup;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

/** How one provider departs from the plain chat-completions request. */
interface WireProfile {
  /** GPT-5.x and the o-series refuse `max_tokens` and want `max_completion_tokens`. */
  readonly sizeField: "max_tokens" | "max_completion_tokens";
  /** How effort travels: OpenAI's field, OpenRouter's object, or not at all. */
  readonly effort: "reasoning_effort" | "openrouter" | "none";
  /** Reasoning the provider requires back on the assistant message during a tool loop. */
  readonly echo: "none" | "reasoning_details" | "reasoning_content";
  /** Sampling temperature for a request that offers tools; unset leaves the server's default. */
  readonly toolTemperature?: number;
}

function profileFor(id: string): WireProfile {
  switch (id) {
    case "openai":
      return { sizeField: "max_completion_tokens", effort: "reasoning_effort", echo: "none" };
    case "openrouter":
      return { sizeField: "max_tokens", effort: "openrouter", echo: "reasoning_details" };
    case "deepseek":
      return { sizeField: "max_tokens", effort: "reasoning_effort", echo: "reasoning_content" };
    case "ollama":
      // A local server mostly ignores effort, and a strict one rejects a field it does not know.
      // Ollama samples at 0.8 unless told otherwise. Measured on qwen2.5-coder:7b with the
      // lean /fix request: at 0.8 the first reply was a tool call 3 times in 6 (the rest were
      // prose that never acted); at 0.2, 6 in 6 - each reading the right file.
      return { sizeField: "max_tokens", effort: "none", echo: "none", toolTemperature: 0.2 };
    default:
      return { sizeField: "max_tokens", effort: "reasoning_effort", echo: "none" };
  }
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

/**
 * How much of a request's prompt the provider read from its cache, or undefined when it did
 * not say. OpenAI, OpenRouter and Groq report `prompt_tokens_details.cached_tokens`; DeepSeek
 * reports `prompt_cache_hit_tokens`. Either way it is part of `prompt_tokens`, not added to it.
 */
export function cachedPromptTokens(tally: Record<string, unknown>): number | undefined {
  const details = tally["prompt_tokens_details"];
  if (typeof details === "object" && details !== null) {
    const cached = (details as Record<string, unknown>)["cached_tokens"];
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) return cached;
  }
  const hit = tally["prompt_cache_hit_tokens"];
  return typeof hit === "number" && Number.isFinite(hit) && hit >= 0 ? hit : undefined;
}

/** The effort level to send this model, or undefined to send none. */
function effortLevel(profile: WireProfile, deps: OpenAiCompatibleDeps, request: ProviderRequest): string | undefined {
  if (profile.effort === "none" || request.effort === undefined) return undefined;
  const traits = deps.traits?.(request.model);
  if (traits !== undefined) return effortFor(request.effort, traits.effortLevels);
  // A model the catalogue does not know: only OpenAI's own reasoning families have a scale
  // worth assuming - the three levels every one of them has accepted since o1.
  if (deps.id === "openai" && /^(?:o\d|gpt-5)/i.test(request.model)) return effortFor(request.effort, ["low", "medium", "high"]);
  return undefined;
}

/** Where the current question starts: after it, reasoning still belongs to the work in hand. */
function currentTurnStart(request: ProviderRequest): number {
  for (let index = request.messages.length - 1; index >= 0; index--) {
    const message = request.messages[index]!;
    if (message.role === "user" && message.content.some((block) => block.type === "text" || block.type === "image")) return index;
  }
  return -1;
}

/**
 * Translate our neutral message shape into the chat-completions one.
 *
 * Deterministic on purpose. OpenAI, DeepSeek, Groq and others cache a prompt's prefix with no
 * field to ask for it, matching byte for byte, so the same history has to come out the same on
 * every step: instructions first and the host context after them, then the turns in order,
 * nothing reordered, timestamped or re-encoded. Only the newest turn should differ.
 */
function toWireMessages(request: ProviderRequest, providerId: string, profile: WireProfile): unknown[] {
  const wire: unknown[] = [{ role: "system", content: request.system }];
  const turnStart = currentTurnStart(request);

  for (const [index, message] of request.messages.entries()) {
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
      // Reasoning goes back only to the provider and model that wrote it, and only for the
      // question in hand: DeepSeek rejects reasoning from earlier questions outright.
      const reasoning = profile.echo === "none" || index < turnStart
        ? undefined
        : toolCalls.find((call) => call.reasoning?.provider === providerId && call.reasoning.model === request.model)?.reasoning;
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
        ...(reasoning === undefined
          ? {}
          : profile.echo === "reasoning_details"
            ? reasoning.details === undefined ? {} : { reasoning_details: reasoning.details }
            : reasoning.text === undefined ? {} : { reasoning_content: reasoning.text }),
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

/**
 * OpenRouter's reasoning items, rebuilt from their streamed fragments.
 *
 * Each delta carries pieces of items keyed by `index`: text arrives a few words at a time
 * and the signature last. Handing back the pieces would not match what the model produced,
 * so fragments of one item are joined into the item a non-streaming reply would have held.
 */
function createDetailMerger(): { add(item: unknown): void; items(): Array<Record<string, unknown>> } {
  const ordered: Array<Record<string, unknown>> = [];
  const byIndex = new Map<number, Record<string, unknown>>();
  return {
    add(item) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return;
      const fragment = item as Record<string, unknown>;
      const key = typeof fragment["index"] === "number" ? fragment["index"] : null;
      const existing = key === null ? undefined : byIndex.get(key);
      if (existing === undefined) {
        const copy = { ...fragment };
        ordered.push(copy);
        if (key !== null) byIndex.set(key, copy);
        return;
      }
      for (const [field, value] of Object.entries(fragment)) {
        if (typeof value === "string" && (field === "text" || field === "summary" || field === "data")) {
          existing[field] = `${typeof existing[field] === "string" ? existing[field] : ""}${value}`;
        } else if (value !== null && value !== undefined) {
          existing[field] = value;
        }
      }
    },
    items: () => ordered,
  };
}

export function createOpenAiCompatibleProvider(deps: OpenAiCompatibleDeps): Provider {
  const doFetch = deps.fetchImpl ?? fetch;
  const profile = profileFor(deps.id);

  return {
    id: deps.id,
    displayName: deps.displayName,
    models: deps.models,

    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      // OpenRouter identifies integrations by referer + title, and keys locked
      // to a referer fail without it. Sent only there — an arbitrary custom
      // endpoint gets nothing beyond the bearer it was given.
      const viaOpenRouter = deps.baseUrl.includes("openrouter.ai");
      const level = effortLevel(profile, deps, request);
      const messages = toWireMessages(request, deps.id, profile);

      const body = (size: number): string =>
        JSON.stringify({
          model: request.model,
          stream: true,
          // OpenAI only sends a streamed reply's token count when asked. Asked of OpenAI alone:
          // it is documented there, and an unknown field is a 400 on some compatible servers.
          ...(deps.id === "openai" ? { stream_options: { include_usage: true } } : {}),
          [profile.sizeField]: size,
          ...(profile.toolTemperature !== undefined && request.tools.length > 0 ? { temperature: profile.toolTemperature } : {}),
          messages,
          ...(level === undefined
            ? {}
            : profile.effort === "openrouter"
              ? { reasoning: { effort: level } }
              : { reasoning_effort: level }),
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
        });

      let size = request.maxTokens;
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        response = await doFetch(`${deps.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            // A local Ollama needs no key; sending an empty bearer would be rejected.
            ...(deps.apiKey.length > 0 ? { authorization: `Bearer ${deps.apiKey}` } : {}),
            ...(viaOpenRouter ? { "HTTP-Referer": "https://adcode.dev", "X-Title": "ADCode" } : {}),
          },
          body: body(size),
        });
        if (response.ok && response.body !== null) break;

        // HTTP errors carry the provider's own explanation as JSON ("model not
        // found", "insufficient credits", "does not support tool use"). A bare
        // status leaves the user with nothing to act on.
        let detail = "";
        let limitMetadata: { code?: string; retryable?: boolean; resetsAt?: number; limit?: "session" | "weekly" | "paid"; buyUrl?: string } = {};
        try {
          const text = (await response.text()).trim().slice(0, 2000);
          if (text.length > 0) {
            // Edge/proxy failures can return an entire branded HTML error page.
            // Keep the HTTP status for recovery without dumping markup into chat.
            if (response.headers.get("content-type")?.toLowerCase().includes("text/html") || /^(?:<!doctype\s+html|<html\b)/i.test(text)) {
              detail = response.status >= 500 ? "The AI service is temporarily unavailable. Try again shortly." : "The server returned an unexpected web page. Check the provider endpoint.";
            } else {
            try {
              const parsed: unknown = JSON.parse(text);
              detail = providerErrorMessage(parsed) ?? text.slice(0, 500);
              const rawError = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["error"] : undefined;
              if (typeof rawError === "object" && rawError !== null) {
                const fields = rawError as Record<string, unknown>;
                limitMetadata = {
                  ...(typeof fields["code"] === "string" ? { code: fields["code"] } : {}),
                  ...(typeof fields["retryable"] === "boolean" ? { retryable: fields["retryable"] } : {}),
                  ...(typeof fields["resetsAt"] === "number" && Number.isSafeInteger(fields["resetsAt"]) ? { resetsAt: fields["resetsAt"] } : {}),
                  ...(fields["limit"] === "session" || fields["limit"] === "weekly" || fields["limit"] === "paid" ? { limit: fields["limit"] } : {}),
                  // Paid tokens (relays from 2026-10-21): where to buy more, only ever an https address.
                  ...(typeof fields["buyUrl"] === "string" && /^https:\/\/[^\s]+$/.test(fields["buyUrl"]) ? { buyUrl: fields["buyUrl"] } : {}),
                };
              }
            } catch {
              detail = text.slice(0, 500);
            }
            }
          }
        } catch {
          // A body that cannot be read has nothing to say.
        }

        // Asked for more output than the model allows or the balance covers: ask once more,
        // at the size the refusal names.
        const allowed = attempt === 0 ? allowedOutputSize(detail) : null;
        if (allowed !== null && allowed >= 256 && allowed < size) {
          size = allowed;
          continue;
        }

        throw Object.assign(
          new Error(`${deps.displayName} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`),
          { status: response.status, retryAfter: response.headers.get("retry-after"), ...limitMetadata },
        );
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const pending = new Map<number, ToolCallAccumulator>();
      const details = createDetailMerger();
      let reasoningText = "";
      // Hold a possible local call until its whole envelope is known. Ordinary prose
      // streams immediately; structured tool_calls always take precedence.
      const recoverLocalCalls = deps.id === "ollama" && request.tools.length > 0;
      const localIds = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      let localText = "";
      let localTextMode: "undecided" | "candidate" | "text" = recoverLocalCalls ? "undecided" : "text";
      // Prose streams through this; calls written in json fences are lifted out of it.
      const fenced = recoverLocalCalls ? createFencedCallFilter(request.tools, `${localIds}_fenced`) : null;

      let buffer = "";
      let finish: string | null = null;
      let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | null = null;
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
          // The count rides a chunk of its own with no choices (OpenAI, OpenRouter, DeepSeek),
          // or under x_groq on Groq's last chunk.
          const record = parsed as Record<string, unknown>;
          const groq = record["x_groq"];
          const counted = record["usage"] ?? (typeof groq === "object" && groq !== null ? (groq as Record<string, unknown>)["usage"] : undefined);
          if (typeof counted === "object" && counted !== null) {
            const tally = counted as Record<string, unknown>;
            if (typeof tally["prompt_tokens"] === "number" || typeof tally["completion_tokens"] === "number") {
              const cached = cachedPromptTokens(tally);
              usage = {
                inputTokens: typeof tally["prompt_tokens"] === "number" ? tally["prompt_tokens"] : 0,
                outputTokens: typeof tally["completion_tokens"] === "number" ? tally["completion_tokens"] : 0,
                ...(cached === undefined ? {} : { cachedTokens: cached }),
              };
            }
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
            if (localTextMode === "text") {
              const shown = fenced === null ? delta["content"] : fenced.push(delta["content"]);
              if (shown.length > 0) yield { kind: "text", text: shown };
            } else {
              localText += delta["content"];
              const start = localText.trimStart();
              if (localTextMode === "undecided" && start.length > 0) {
                localTextMode = /^[{[<]/.test(start) ? "candidate" : "text";
                if (localTextMode === "text") {
                  const shown = fenced === null ? localText : fenced.push(localText);
                  if (shown.length > 0) yield { kind: "text", text: shown };
                  localText = "";
                }
              }
            }
          }

          // Reasoning arrives as `reasoning_content` (DeepSeek, Qwen, many local servers) or
          // `reasoning` (OpenRouter, Groq). Either way it is for the trace, and - for the
          // providers that ask for it - for handing back during the tool loop.
          const thought = typeof delta["reasoning_content"] === "string"
            ? delta["reasoning_content"]
            : typeof delta["reasoning"] === "string" ? delta["reasoning"] : "";
          if (thought.length > 0) {
            reasoningText += thought;
            yield { kind: "thinking", text: thought };
          }
          if (Array.isArray(delta["reasoning_details"])) {
            for (const item of delta["reasoning_details"]) details.add(item);
          }

          const calls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
          for (const call of calls ?? []) {
            const index = typeof call["index"] === "number" ? call["index"] : 0;
            const fn = call["function"] as Record<string, unknown> | undefined;

            const existing = pending.get(index) ?? { id: "", name: "", args: "" };
            if (typeof call["id"] === "string") existing.id = call["id"];
            if (typeof fn?.["name"] === "string") existing.name = fn["name"];
            pending.set(index, existing);
            if (typeof fn?.["arguments"] === "string" && fn["arguments"].length > 0) {
              existing.args += fn["arguments"];
              yield { kind: "tool-input", index, id: existing.id, name: existing.name, fragment: fn["arguments"] };
            }
          }
        }
      }

      if (signal.aborted) return;

      // Native calls are authoritative, and a reply cut short never runs what it was writing.
      const trustLocalCalls = pending.size === 0 && finish !== "length" && finish !== "content_filter";
      const opening = trustLocalCalls && localText.length > 0 ? localToolCalls(localText, request.tools, localIds) : null;
      const tail = fenced?.finish() ?? { text: "", calls: [], raw: "" };
      const fencedRun = trustLocalCalls && opening === null && tail.calls.length > 0 ? tail.calls : null;
      const recovered = opening ?? fencedRun;
      if (opening === null && localText.length > 0) yield { kind: "text", text: localText };
      if (fencedRun === null && tail.raw.length > 0) yield { kind: "text", text: tail.raw };
      if (recovered !== null) {
        yield { kind: "status", text: "Recovering the local model's tool call" };
        for (const call of recovered) yield { kind: "tool-call", call };
      }

      const reasoning: ProviderReasoning | undefined =
        profile.echo === "reasoning_details" && details.items().length > 0
          ? { provider: deps.id, model: request.model, details: details.items() }
          : profile.echo === "reasoning_content" && reasoningText.length > 0
            ? { provider: deps.id, model: request.model, text: reasoningText }
            : undefined;

      let firstCall = true;
      for (const accumulator of pending.values()) {
        let input: Record<string, unknown> = {};
        let inputError: string | undefined;
        const parsed = parseToolArguments(accumulator.args);
        if (parsed !== null) {
          input = parsed.input;
          if (parsed.normalized && finish !== "length") yield { kind: "status", text: "Recovered the model's tool argument formatting" };
        } else {
          inputError = "Tool not run: the provider returned invalid JSON tool arguments. No file was changed by this call. Retry with one smaller call: a short, complete JSON object matching the tool schema. Use JSON escapes for newlines and quotes. For a new file, create a minimal complete version (at most 40 lines) with propose_edit, then extend it with small edit_file calls. Read existing files before editing them. Do not resend the same full file. This is not a workspace permission error.";
        }
        if (finish === "length") {
          // Even valid JSON may contain a file the model had not finished writing.
          // Never execute calls from a response the provider says was cut short.
          input = {};
          inputError = "Tool not run: the model's response limit cut off the tool arguments. Retry with one smaller call. Create a short complete file with propose_edit, then extend it using edit_file in smaller steps. Do not resend the same full file. This is not a workspace permission error.";
        }

        const toolCall: ToolCallBlock = {
          type: "tool-call",
          id: accumulator.id.length > 0 ? accumulator.id : `call_${accumulator.name}`,
          name: accumulator.name,
          input,
          ...(inputError === undefined ? {} : { inputError }),
          ...(firstCall && reasoning !== undefined ? { reasoning } : {}),
        };
        firstCall = false;
        yield { kind: "tool-call", call: toolCall };
      }

      if (signal.aborted) return;

      if (usage !== null) yield { kind: "usage", ...usage };
      if (finish === "length") {
        yield { kind: "stop", reason: "max-tokens" };
      } else if (finish === "content_filter") {
        yield { kind: "stop", reason: "refusal", detail: "declined (content filter)" };
      } else if (finish === "tool_calls" || pending.size > 0 || recovered !== null) {
        yield { kind: "stop", reason: "tool-use" };
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
