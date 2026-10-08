import { describe, it, expect } from "vitest";
import {
  createOllamaProvider,
  createOpenAiCompatibleProvider,
  createOpenAiProvider,
  providerErrorMessage,
} from "../src/providers/openaiCompatible.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";
import { createAgent } from "../src/agent.ts";
import { PROPOSE_EDIT } from "../src/tools.ts";

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

  it("marks malformed tool arguments as invalid instead of silently executing an empty object", async () => {
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
    expect(call).toMatchObject({ kind: "tool-call", call: {
      input: {}, inputError: expect.stringContaining("invalid JSON"),
    } });
  });

  it.each(["null", "[]", '"text"', "123"])("rejects non-object tool arguments: %s", async (args) => {
    const provider = createOpenAiProvider("key", sseFetch([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "propose_edit", arguments: args } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
    ]));
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.find((event) => event.kind === "tool-call")).toMatchObject({ kind: "tool-call", call: { input: {}, inputError: expect.any(String) } });
  });

  it.each(['{"path":"index.html","contents":"unfinished', '{"path":"index.html","contents":"short"}'])(
    "does not authorize edits when the provider reports a length cutoff",
    async (args) => {
      const provider = createOpenAiProvider("key", sseFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "propose_edit", arguments: args } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`,
      ]));
      const events = await collect(provider.stream(request, new AbortController().signal));
      expect(events.find((event) => event.kind === "tool-call")).toMatchObject({ kind: "tool-call", call: { input: {}, inputError: expect.stringContaining("response limit") } });
      expect(events.at(-1)).toEqual({ kind: "stop", reason: "max-tokens" });
    },
  );

  it.each(["tool_calls", "length"])("recovers a %s failure without sending incomplete arguments to the file runner", async (finish) => {
    const requests: ProviderRequest[] = [];
    let round = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const args = round++ === 0 ? '{"path":"index.html","contents":"private partial' : JSON.stringify({path: "index.html", contents: "<h1>Hello</h1>"});
      return sseFetch(round > 2 ? [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ] : [
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${round}`, function: { name: "propose_edit", arguments: args } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: round === 1 ? finish : "tool_calls" }] })}`,
      ])(url, init);
    };
    const executed: unknown[] = [];
    const agent = createAgent({
      provider: createOpenAiProvider("key", fetchImpl), model: "test", tools: [PROPOSE_EDIT],
      runner: { async run(call) { executed.push(call.input); return {content: "File written", isError: false}; } },
    });
    const events = [];
    for await (const event of agent.send("Create a page")) events.push(event);
    expect(executed).toEqual([{path: "index.html", contents: "<h1>Hello</h1>"}]);
    expect(events.at(-1)).toMatchObject({kind: "turn-end"});
    expect(events).toContainEqual(expect.objectContaining({kind: "tool-result", isError: true, content: expect.stringContaining("Tool not run:")}));
    expect(JSON.stringify(requests[1])).toContain("one smaller call");
    expect(JSON.stringify(agent.history())).not.toContain("private partial");
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

/* ── What each provider expects on the wire ─────────────────────────────── */

const data = (payload: unknown): string => `data: ${JSON.stringify(payload)}`;
const STOP = [data({ choices: [{ delta: {}, finish_reason: "stop" }] })];

/** Records every request body and answers each with the next scripted response. */
function scripted(responses: Array<() => Response>, bodies: Array<Record<string, unknown>>): typeof fetch {
  let index = 0;
  return (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return next();
  }) as unknown as typeof fetch;
}

function stream(lines: string[]): () => Response {
  return () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
          controller.close();
        },
      }),
      { status: 200 },
    );
}

const failure = (status: number, message: string) => () =>
  new Response(JSON.stringify({ error: { message, code: status } }), { status });

function provider(id: string, bodies: Array<Record<string, unknown>>, responses: Array<() => Response>, traits?: Parameters<typeof createOpenAiCompatibleProvider>[0]["traits"]) {
  return createOpenAiCompatibleProvider({
    id,
    displayName: id,
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    models: [],
    fetchImpl: scripted(responses, bodies),
    ...(traits === undefined ? {} : { traits }),
  });
}

describe("output size", () => {
  // GPT-5.x and the o-series refuse max_tokens outright and want max_completion_tokens -
  // which is why most current OpenAI models failed on their very first message.
  it("asks OpenAI for max_completion_tokens", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("openai", bodies, [stream(STOP)]).stream(request, new AbortController().signal));
    expect(bodies[0]?.["max_completion_tokens"]).toBe(1024);
    expect(bodies[0]).not.toHaveProperty("max_tokens");
  });

  it("keeps max_tokens for every other provider", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("groq", bodies, [stream(STOP)]).stream(request, new AbortController().signal));
    expect(bodies[0]?.["max_tokens"]).toBe(1024);
    expect(bodies[0]).not.toHaveProperty("max_completion_tokens");
  });

  it("asks again within what an OpenRouter balance can pay for", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const events = await collect(
      provider("openrouter", bodies, [
        failure(402, "This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 3000."),
        stream([data({ choices: [{ delta: { content: "ok" } }] }), ...STOP]),
      ]).stream({ ...request, maxTokens: 16384 }, new AbortController().signal),
    );
    expect(events.some((event) => event.kind === "text")).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(Number(bodies[1]?.["max_tokens"])).toBeLessThanOrEqual(3000);
    expect(Number(bodies[1]?.["max_tokens"])).toBeGreaterThan(2000);
  });

  it("asks again within the model's own limit when the size is too large", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(
      provider("openai", bodies, [
        failure(400, "max_tokens is too large: 65536. This model supports at most 32768 completion tokens, whereas you provided 65536."),
        stream(STOP),
      ]).stream({ ...request, maxTokens: 65536 }, new AbortController().signal),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.["max_completion_tokens"]).toBe(32768);
  });

  it("does not loop on a size refusal it cannot read", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await expect(
      collect(provider("groq", bodies, [failure(400, "something else entirely")]).stream(request, new AbortController().signal)),
    ).rejects.toThrow(/something else entirely/);
    expect(bodies).toHaveLength(1);
  });
});

describe("effort, in each model's own levels", () => {
  it("gives Max the model's highest level", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(
      provider("openai", bodies, [stream(STOP)], () => ({ reasoning: true, effortLevels: ["minimal", "low", "medium", "high"] }))
        .stream({ ...request, effort: "max" }, new AbortController().signal),
    );
    expect(bodies[0]?.["reasoning_effort"]).toBe("high");
  });

  it("sends no effort to a model that has no levels", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(
      provider("openai", bodies, [stream(STOP)], () => ({ reasoning: false, effortLevels: null }))
        .stream({ ...request, model: "gpt-4.1", effort: "high" }, new AbortController().signal),
    );
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("sends no effort to a provider's model the catalogue does not know", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("mistral", bodies, [stream(STOP)]).stream({ ...request, effort: "high" }, new AbortController().signal));
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("tells OpenRouter as reasoning.effort, which is the shape it reads", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(
      provider("openrouter", bodies, [stream(STOP)], () => ({ reasoning: true, effortLevels: ["low", "medium", "high"] }))
        .stream({ ...request, effort: "max" }, new AbortController().signal),
    );
    expect(bodies[0]?.["reasoning"]).toEqual({ effort: "high" });
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });
});

describe("reasoning handed back during a tool loop", () => {
  const toolTurn = [
    data({ choices: [{ delta: { reasoning: "Need the file. ", reasoning_details: [{ type: "reasoning.text", text: "Need the ", index: 0, format: "anthropic-claude-v1" }] } }] }),
    data({ choices: [{ delta: { reasoning: "Reading it.", reasoning_details: [{ type: "reasoning.text", text: "file.", index: 0, signature: "sig-9" }] } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: "{\"path\":\"a\"}" } }] } }] }),
    data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ];

  it("shows OpenRouter's reasoning text in the trace", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const events = await collect(provider("openrouter", bodies, [stream(toolTurn)]).stream(request, new AbortController().signal));
    expect(events.filter((event) => event.kind === "thinking").map((event) => (event as { text: string }).text).join(""))
      .toBe("Need the file. Reading it.");
  });

  it("keeps OpenRouter's reasoning_details with the call they led to, merged by index", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const events = await collect(provider("openrouter", bodies, [stream(toolTurn)]).stream({ ...request, model: "anthropic/claude-sonnet-5" }, new AbortController().signal));
    const call = events.find((event) => event.kind === "tool-call");
    expect(call?.kind === "tool-call" ? call.call.reasoning : undefined).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
      details: [{ type: "reasoning.text", text: "Need the file.", index: 0, format: "anthropic-claude-v1", signature: "sig-9" }],
    });
  });

  const history = (model: string): ProviderRequest => ({
    ...request,
    model,
    messages: [
      { role: "user", content: [{ type: "text", text: "read a" }] },
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          id: "c1",
          name: "read_file",
          input: { path: "a" },
          reasoning: { provider: "openrouter", model: "anthropic/claude-sonnet-5", details: [{ type: "reasoning.text", text: "x", signature: "s" }] },
        }],
      },
      { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "A", isError: false }] },
    ],
  });

  it("hands reasoning_details back on the assistant message that made the call", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("openrouter", bodies, [stream(STOP)]).stream(history("anthropic/claude-sonnet-5"), new AbortController().signal));
    const assistant = (bodies[0]?.["messages"] as Array<Record<string, unknown>>).find((message) => message["role"] === "assistant");
    expect(assistant?.["reasoning_details"]).toEqual([{ type: "reasoning.text", text: "x", signature: "s" }]);
  });

  it("never hands one model's reasoning to another", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("openrouter", bodies, [stream(STOP)]).stream(history("google/gemini-3.5-flash"), new AbortController().signal));
    const assistant = (bodies[0]?.["messages"] as Array<Record<string, unknown>>).find((message) => message["role"] === "assistant");
    expect(assistant).not.toHaveProperty("reasoning_details");
  });

  it("keeps DeepSeek's reasoning_content with its call and sends it back in the same turn", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const events = await collect(
      provider("deepseek", bodies, [stream([
        data({ choices: [{ delta: { reasoning_content: "Look first." } }] }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: "{}" } }] } }] }),
        data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ])]).stream({ ...request, model: "deepseek-v4-pro" }, new AbortController().signal),
    );
    const call = events.find((event) => event.kind === "tool-call");
    const reasoning = call?.kind === "tool-call" ? call.call.reasoning : undefined;
    expect(reasoning).toEqual({ provider: "deepseek", model: "deepseek-v4-pro", text: "Look first." });

    const next: Array<Record<string, unknown>> = [];
    await collect(provider("deepseek", next, [stream(STOP)]).stream({
      ...request,
      model: "deepseek-v4-pro",
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "read_file", input: {}, ...(reasoning === undefined ? {} : { reasoning }) }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "A", isError: false }] },
      ],
    }, new AbortController().signal));
    const assistant = (next[0]?.["messages"] as Array<Record<string, unknown>>).find((message) => message["role"] === "assistant");
    expect(assistant?.["reasoning_content"]).toBe("Look first.");
  });

  it("does not send DeepSeek the reasoning of an earlier question", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await collect(provider("deepseek", bodies, [stream(STOP)]).stream({
      ...request,
      model: "deepseek-v4-pro",
      messages: [
        { role: "user", content: [{ type: "text", text: "first question" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "read_file", input: {}, reasoning: { provider: "deepseek", model: "deepseek-v4-pro", text: "old" } }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "A", isError: false }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
        { role: "user", content: [{ type: "text", text: "second question" }] },
      ],
    }, new AbortController().signal));
    const assistants = (bodies[0]?.["messages"] as Array<Record<string, unknown>>).filter((message) => message["role"] === "assistant");
    expect(assistants.every((message) => !("reasoning_content" in message))).toBe(true);
  });
});
