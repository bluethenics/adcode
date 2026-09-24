import { describe, it, expect } from "vitest";
import {
  createOllamaProvider,
  createOpenAiCompatibleProvider,
  createOpenAiProvider,
  providerErrorMessage,
} from "../src/providers/openaiCompatible.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

/** Build a fetch that replays server-sent event lines. */
function sseFetch(lines: string[], status = 200): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });

    return new Response(status === 200 ? body : null, { status });
  }) as unknown as typeof fetch;
}

const request: ProviderRequest = {
  model: "gpt-5",
  system: "be helpful",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxTokens: 1024,
};

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("streaming text", () => {
  it("yields each content delta and ends the turn", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
      ]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));

    expect(events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text).join("")).toBe(
      "Hello",
    );
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("surfaces a reasoning channel when the server streams one", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "weighing" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.some((e) => e.kind === "thinking")).toBe(true);
  });

  it("ignores malformed lines instead of failing the stream", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        ": a comment",
        "data: {not json",
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.some((e) => e.kind === "text")).toBe(true);
  });
});

describe("tool calls", () => {
  it("reassembles arguments streamed across several deltas", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `data: ${JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"pa' } }] } },
          ],
        })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }],
        })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      ]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    const call = events.find((e) => e.kind === "tool-call");

    expect(call).toBeDefined();
    if (call?.kind === "tool-call") {
      expect(call.call.name).toBe("read_file");
      expect(call.call.input).toEqual({ path: "a.ts" });
    }
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "tool-use" });
  });

  it("does not throw on malformed tool arguments", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `data: ${JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{oops" } }] } }],
        })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      ]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    const call = events.find((e) => e.kind === "tool-call");
    if (call?.kind === "tool-call") expect(call.call.input).toEqual({});
  });
});

describe("stop reasons", () => {
  it("maps a content filter to a refusal, not an error", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "content_filter" }] })}`]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ kind: "stop", reason: "refusal" });
  });

  it("maps a length cut-off to max-tokens", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`]),
    );

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "max-tokens" });
  });

  it("throws on a non-200 so the agent loop can report it", async () => {
    const provider = createOpenAiProvider("key", sseFetch([], 429));
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toThrow(/429/);
  });

  it("reads provider error objects out of an otherwise-200 stream", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `: OPENROUTER PROCESSING`,
        `data: ${JSON.stringify({ error: { message: "No endpoints found for model", code: 404 } })}`,
      ]),
    );
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toThrow(
      /No endpoints found for model/,
    );
  });

  it("includes the provider's own explanation on HTTP errors", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: "Insufficient credits", code: 402 } }), {
        status: 402,
      })) as unknown as typeof fetch;
    const provider = createOpenAiProvider("key", failing);
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toThrow(
      /402.*Insufficient credits/,
    );
  });

  it("announces a queued upstream once instead of waiting in silence", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        ": OPENROUTER PROCESSING",
        ": OPENROUTER PROCESSING",
        `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ]),
    );
    const events = await collect(provider.stream(request, new AbortController().signal));
    const notes = events.filter((e) => e.kind === "thinking");
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes[0])).toContain("waiting");
  });

  it("skips non-object data lines without failing", async () => {
    const provider = createOpenAiProvider(
      "key",
      sseFetch([
        `data: "just a string"`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ]),
    );
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.some((e) => e.kind === "text")).toBe(true);
  });
});

describe("provider error messages", () => {
  it("reads object, string, and coded shapes", () => {
    expect(providerErrorMessage({ error: { message: "boom", code: 500 } })).toContain("boom");
    expect(providerErrorMessage({ error: "flat" })).toBe("flat");
    expect(providerErrorMessage({ choices: [] })).toBeNull();
    expect(providerErrorMessage(null)).toBeNull();
  });
});

describe("OpenRouter identification", () => {
  it("sends referer and title only to OpenRouter", async () => {
    let seen: Record<string, string> = {};
    const capturing = (async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const routed = createOpenAiCompatibleProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "key",
      models: ["x"],
      fetchImpl: capturing,
    });
    await collect(routed.stream(request, new AbortController().signal));
    expect(seen["HTTP-Referer"]).toBe("https://adcode.dev");
    expect(seen["X-Title"]).toBe("ADCode");

    const other = createOpenAiCompatibleProvider({
      id: "custom",
      displayName: "Custom",
      baseUrl: "https://example.com/v1",
      apiKey: "key",
      models: ["x"],
      fetchImpl: capturing,
    });
    await collect(other.stream(request, new AbortController().signal));
    expect(seen["HTTP-Referer"]).toBeUndefined();
  });
});

describe("the local endpoint", () => {
  it("sends no authorization header, since it is the user's own machine", async () => {
    let seenHeaders: Record<string, string> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      seenHeaders = init.headers as Record<string, string>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const provider = createOllamaProvider(undefined, capturing);
    await collect(provider.stream(request, new AbortController().signal));

    expect(seenHeaders["authorization"]).toBeUndefined();
  });

  it("defaults to localhost", () => {
    expect(createOllamaProvider().displayName).toContain("Local");
  });
});

describe("message translation", () => {
  it("sends tool results as their own tool-role messages", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const provider = createOpenAiProvider("key", capturing);
    await collect(
      provider.stream(
        {
          ...request,
          messages: [
            { role: "user", content: [{ type: "text", text: "go" }] },
            {
              role: "assistant",
              content: [{ type: "tool-call", id: "c1", name: "f", input: {} }],
            },
            {
              role: "user",
              content: [{ type: "tool-result", toolCallId: "c1", content: "42", isError: false }],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    const messages = body["messages"] as Array<Record<string, unknown>>;
    expect(messages.some((m) => m["role"] === "tool" && m["tool_call_id"] === "c1")).toBe(true);
  });

  it("sends attached images as image_url parts beside the text", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const provider = createOpenAiProvider("key", capturing);
    await collect(
      provider.stream(
        {
          ...request,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
                { type: "text", text: "what is this?" },
              ],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    const messages = body["messages"] as Array<Record<string, unknown>>;
    const user = messages.find((m) => m["role"] === "user");
    const content = user?.["content"] as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "what is this?" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,aGVsbG8=" },
    });
  });

  it("keeps text-only turns as a plain string", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const provider = createOpenAiProvider("key", capturing);
    await collect(provider.stream(request, new AbortController().signal));

    const messages = body["messages"] as Array<Record<string, unknown>>;
    expect(messages[1]?.["content"]).toBe("hi");
  });

  it("marks an errored tool result so the model can see it failed", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`])(
        "",
        init,
      );
    }) as unknown as typeof fetch;

    const provider = createOpenAiProvider("key", capturing);
    await collect(
      provider.stream(
        {
          ...request,
          messages: [
            {
              role: "user",
              content: [{ type: "tool-result", toolCallId: "c1", content: "boom", isError: true }],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    const messages = body["messages"] as Array<Record<string, unknown>>;
    const toolMessage = messages.find((m) => m["role"] === "tool");
    expect(String(toolMessage?.["content"])).toContain("ERROR");
  });
});

describe("reasoning effort", () => {
  const stop = [`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`];

  function capturingBody(sent: { body?: Record<string, unknown> }): typeof fetch {
    return (async (_url: string, init: RequestInit) => {
      sent.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch(stop)("", init);
    }) as unknown as typeof fetch;
  }

  it("sends reasoning_effort only when the user picked one", async () => {
    const sent: { body?: Record<string, unknown> } = {};
    const provider = createOpenAiProvider("key", capturingBody(sent));

    await collect(provider.stream(request, new AbortController().signal));
    expect(sent.body?.["reasoning_effort"]).toBeUndefined();

    await collect(
      provider.stream({ ...request, effort: "high" }, new AbortController().signal),
    );
    expect(sent.body?.["reasoning_effort"]).toBe("high");
  });

  it("never sends effort to a local Ollama", async () => {
    const sent: { body?: Record<string, unknown> } = {};
    const provider = createOllamaProvider(undefined, capturingBody(sent));

    await collect(
      provider.stream({ ...request, effort: "max" }, new AbortController().signal),
    );
    expect(sent.body?.["reasoning_effort"]).toBeUndefined();
  });
});
