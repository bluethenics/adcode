import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createAgent } from "../src/agent.ts";
import { createAnthropicProvider, MAX_CACHE_BREAKPOINTS } from "../src/providers/anthropic.ts";
import { cachedPromptTokens, createOpenAiProvider } from "../src/providers/openaiCompatible.ts";
import type { AgentEvent, Message, ProviderEvent, ProviderRequest, ToolDefinition, ToolRunner } from "../src/types.ts";

/**
 * Prompt caching: every agent step re-sends the system prompt, the tools and the whole history.
 * These tests hold the two things caching depends on - breakpoints where the next step will
 * look for them, and a prefix that comes out byte for byte the same from one step to the next.
 */

const INSTRUCTIONS = "You are the test agent. Follow the rules.";

const echo: ToolDefinition = {
  name: "echo",
  description: "Echo the input back",
  inputSchema: { type: "object", properties: { value: { type: "string" } } },
  mutating: false,
};

const runner: ToolRunner = { run: async () => ({ content: "echoed", isError: false }) };

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** How many breakpoints a request body carries, wherever they sit. */
function breakpoints(body: unknown): number {
  return JSON.stringify(body).split('"cache_control"').length - 1;
}

/** One scripted Claude reply: stream events, then what `finalMessage()` returns. */
interface ClaudeTurn {
  readonly events: Array<Record<string, unknown>>;
  readonly final: Record<string, unknown>;
}

/** The SDK client, faked: snapshot each request's params, replay one scripted turn per call. */
function claudeClient(turns: ClaudeTurn[], sent: Array<Record<string, unknown>>): Anthropic {
  let index = 0;
  return {
    messages: {
      stream: (params: Record<string, unknown>) => {
        sent.push(JSON.parse(JSON.stringify(params)) as Record<string, unknown>);
        const turn = turns[index++] ?? { events: [], final: { stop_reason: "end_turn", content: [] } };
        async function* events(): AsyncIterable<Record<string, unknown>> {
          yield* turn.events;
        }
        return Object.assign(events(), { finalMessage: async () => turn.final });
      },
    },
  } as unknown as Anthropic;
}

const toolTurn: ClaudeTurn = {
  events: [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "echo", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"value":"x"}' } },
    { type: "content_block_stop", index: 0 },
  ],
  final: {
    stop_reason: "tool_use",
    content: [],
    usage: { input_tokens: 12, cache_creation_input_tokens: 5000, cache_read_input_tokens: 0, output_tokens: 20 },
  },
};

const answerTurn: ClaudeTurn = {
  events: [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } }],
  final: {
    stop_reason: "end_turn",
    content: [],
    usage: { input_tokens: 30, cache_creation_input_tokens: 40, cache_read_input_tokens: 5000, output_tokens: 5 },
  },
};

describe("Anthropic cache breakpoints", () => {
  async function twoSteps(context: () => string): Promise<{ sent: Array<Record<string, unknown>>; events: AgentEvent[] }> {
    const sent: Array<Record<string, unknown>> = [];
    const provider = createAnthropicProvider({ apiKey: "k", client: claudeClient([toolTurn, answerTurn], sent) });
    const agent = createAgent({ provider, model: "claude-opus-5-5", system: INSTRUCTIONS, tools: [echo], runner, context });
    const events = await collect(agent.send("look at this"));
    return { sent, events };
  }

  it("marks the tool list, the instructions and the newest message on the first step", async () => {
    const { sent } = await twoSteps(() => "Cursor on line 4.");
    const first = sent[0]!;

    const tools = first["tools"] as Array<Record<string, unknown>>;
    expect(tools.at(-1)).toMatchObject({ name: "echo", cache_control: { type: "ephemeral" } });

    // The instructions carry the breakpoint; the host context read fresh each step follows it.
    expect(first["system"]).toEqual([
      { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
      { type: "text", text: "Cursor on line 4." },
    ]);

    const messages = first["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content.at(-1)).toMatchObject({ type: "text", text: "look at this", cache_control: { type: "ephemeral" } });
    expect(breakpoints(first)).toBe(3);
  });

  it("re-sends the first step's prefix byte for byte, breakpoint included, so the next step reads it back", async () => {
    const { sent } = await twoSteps(() => "Cursor on line 4.");
    const [first, second] = sent as [Record<string, unknown>, Record<string, unknown>];
    const before = first["messages"] as unknown[];
    const after = second["messages"] as Array<{ role: string; content: Array<Record<string, unknown>> }>;

    expect(after).toHaveLength(3);
    // The previous request ended at message 0 with a breakpoint on its last block. The next
    // request carries that block - and that breakpoint - exactly where it was.
    expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before));
    expect(JSON.stringify(second["tools"])).toBe(JSON.stringify(first["tools"]));
    expect(JSON.stringify(second["system"])).toBe(JSON.stringify(first["system"]));

    // And the newest message - the tool results - writes this step's prefix for the next one.
    expect(after[2]!.role).toBe("user");
    expect(after[2]!.content.at(-1)).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", cache_control: { type: "ephemeral" } });
    // The assistant's turn between them carries none.
    expect(breakpoints(after[1])).toBe(0);
    expect(breakpoints(second)).toBe(MAX_CACHE_BREAKPOINTS);
  });

  it("keeps the instructions' cache when the host context changes between steps", async () => {
    let step = 0;
    const { sent } = await twoSteps(() => `Cursor on line ${String(++step)}.`);
    const [first, second] = sent as [Record<string, unknown>, Record<string, unknown>];
    const firstSystem = first["system"] as Array<Record<string, unknown>>;
    const secondSystem = second["system"] as Array<Record<string, unknown>>;
    expect(secondSystem[0]).toEqual(firstSystem[0]);
    expect(secondSystem[1]).toEqual({ type: "text", text: "Cursor on line 2." });
  });

  it("never carries more than four breakpoints, however long the conversation", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const provider = createAnthropicProvider({ apiKey: "k", client: claudeClient([answerTurn], sent) });
    const messages: Message[] = [];
    for (let turn = 0; turn < 12; turn++) {
      messages.push({ role: "user", content: [{ type: "text", text: `question ${String(turn)}` }] });
      messages.push({ role: "assistant", content: [{ type: "tool-call", id: `c${String(turn)}`, name: "echo", input: { value: "x" } }] });
      messages.push({ role: "user", content: [{ type: "tool-result", toolCallId: `c${String(turn)}`, content: "ok", isError: false }] });
      messages.push({ role: "assistant", content: [{ type: "text", text: `answer ${String(turn)}` }] });
    }
    messages.push({ role: "user", content: [{ type: "text", text: "and now?" }] });
    const tools = Array.from({ length: 30 }, (_, index): ToolDefinition => ({ ...echo, name: `tool_${String(index)}` }));

    await collect(provider.stream({ model: "claude-opus-5-5", system: `${INSTRUCTIONS}\n\nctx`, cache: { stableSystem: INSTRUCTIONS.length }, messages, tools, maxTokens: 64 }, new AbortController().signal));

    expect(breakpoints(sent[0])).toBe(MAX_CACHE_BREAKPOINTS);
    const wire = sent[0]!["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
    // The newest message, and the last user message before it - where the previous request ended.
    expect(wire.at(-1)!.content.at(-1)).toHaveProperty("cache_control");
    expect(wire.at(-3)!.content.at(-1)).toHaveProperty("cache_control");
  });

  it("puts a breakpoint on the last block that can take one, never on empty text", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const provider = createAnthropicProvider({ apiKey: "k", client: claudeClient([answerTurn], sent) });
    await collect(provider.stream({
      model: "claude-opus-5-5",
      system: INSTRUCTIONS,
      cache: { stableSystem: INSTRUCTIONS.length },
      messages: [{ role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "ok", isError: false }, { type: "text", text: "  " }] }],
      tools: [],
      maxTokens: 64,
    }, new AbortController().signal));
    const content = (sent[0]!["messages"] as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    expect(content[0]).toHaveProperty("cache_control");
    expect(content[1]).not.toHaveProperty("cache_control");
    // Nothing follows the instructions, so the system prompt is the one marked block.
    expect(sent[0]!["system"]).toEqual([{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }]);
  });

  it("asks nothing of the cache for a one-off request, which would pay for a write nobody reads", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const provider = createAnthropicProvider({ apiKey: "k", client: claudeClient([answerTurn], sent) });
    const oneOff: ProviderRequest = {
      model: "claude-opus-5-5",
      system: "Complete the code.",
      messages: [{ role: "user", content: [{ type: "text", text: "const a =" }] }],
      tools: [echo],
      maxTokens: 64,
    };
    await collect(provider.stream(oneOff, new AbortController().signal));
    expect(breakpoints(sent[0])).toBe(0);
    expect(sent[0]!["system"]).toBe("Complete the code.");
  });

  it("reports what was read from cache as part of the input, not on top of it", async () => {
    const { events } = await twoSteps(() => "ctx");
    expect(events.filter((event) => event.kind === "usage")).toEqual([
      { kind: "usage", inputTokens: 5012, outputTokens: 20, cachedTokens: 0, estimated: false, durationMs: expect.any(Number), firstResponseMs: expect.any(Number) },
      { kind: "usage", inputTokens: 5070, outputTokens: 5, cachedTokens: 5000, estimated: false, durationMs: expect.any(Number), firstResponseMs: expect.any(Number) },
    ]);
  });
});

/** Server-sent event lines as a fetch response. */
function sse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe("OpenAI-compatible prefix stability", () => {
  async function twoSteps(): Promise<{ bodies: Array<Record<string, unknown>>; events: AgentEvent[] }> {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return bodies.length === 1
        ? sse([
            JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "echo", arguments: '{"value":"x"}' } }] } }] }),
            JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
            JSON.stringify({ choices: [], usage: { prompt_tokens: 1800, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 0 } } }),
          ])
        : sse([
            JSON.stringify({ choices: [{ delta: { content: "done" } }] }),
            JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
            JSON.stringify({ choices: [], usage: { prompt_tokens: 2100, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1792 } } }),
          ]);
    }) as unknown as typeof fetch;
    const agent = createAgent({
      provider: createOpenAiProvider("key", fetchImpl),
      model: "gpt-5.6",
      system: INSTRUCTIONS,
      tools: [echo],
      runner,
      context: () => "Cursor on line 4.",
    });
    const events = await collect(agent.send("look at this"));
    return { bodies, events };
  }

  it("sends the next step's history starting with exactly the bytes of the last one", async () => {
    const { bodies } = await twoSteps();
    const [first, second] = bodies as [Record<string, unknown>, Record<string, unknown>];
    const before = first["messages"] as unknown[];
    const after = second["messages"] as unknown[];

    expect(after.length).toBeGreaterThan(before.length);
    expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before));
    expect(JSON.stringify(second["tools"])).toBe(JSON.stringify(first["tools"]));
    // Instructions first, the host context after them: the part that changes comes last.
    expect((after[0] as { role: string; content: string })).toEqual({ role: "system", content: `${INSTRUCTIONS}\n\nCursor on line 4.` });
    // Automatic caching needs nothing on the wire: no Anthropic-only field reaches these servers.
    expect(breakpoints(second)).toBe(0);
  });

  it("reports the cached part of the prompt the provider says it served", async () => {
    const { events } = await twoSteps();
    expect(events.filter((event) => event.kind === "usage")).toEqual([
      { kind: "usage", inputTokens: 1800, outputTokens: 12, cachedTokens: 0, estimated: false, durationMs: expect.any(Number), firstResponseMs: expect.any(Number) },
      { kind: "usage", inputTokens: 2100, outputTokens: 3, cachedTokens: 1792, estimated: false, durationMs: expect.any(Number), firstResponseMs: expect.any(Number) },
    ]);
  });

  it("reads OpenAI's and DeepSeek's shapes, and says nothing when there is no count", () => {
    expect(cachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } })).toBe(64);
    expect(cachedPromptTokens({ prompt_tokens: 100, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 })).toBe(80);
    expect(cachedPromptTokens({ prompt_tokens: 100 })).toBeUndefined();
    expect(cachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: "lots" } })).toBeUndefined();
  });
});

describe("agent usage events", () => {
  function scripted(events: ProviderEvent[]) {
    return {
      id: "anthropic" as const,
      displayName: "Scripted",
      models: ["test-model"],
      requests: [] as ProviderRequest[],
      async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        this.requests.push(request);
        yield* events;
      },
    };
  }

  it("asks the provider to cache each step, marking where the instructions end", async () => {
    const provider = scripted([{ kind: "text", text: "hi" }, { kind: "stop", reason: "end-turn" }]);
    const agent = createAgent({ provider, model: "test-model", system: INSTRUCTIONS, tools: [], runner, context: () => "Cursor on line 9." });
    await collect(agent.send("hello"));
    const request = provider.requests[0]!;
    expect(request.cache).toEqual({ stableSystem: INSTRUCTIONS.length });
    expect(request.system.slice(0, request.cache!.stableSystem)).toBe(INSTRUCTIONS);
  });

  it("never claims more was cached than the request carried", async () => {
    const provider = scripted([{ kind: "usage", inputTokens: 100, outputTokens: 2, cachedTokens: 400 }, { kind: "stop", reason: "end-turn" }]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner });
    const usage = (await collect(agent.send("hello"))).find((event) => event.kind === "usage");
    expect(usage).toEqual({ kind: "usage", inputTokens: 100, outputTokens: 2, cachedTokens: 100, estimated: false, durationMs: expect.any(Number), firstResponseMs: expect.any(Number) });
  });

  it("claims no cached tokens for a count it estimated itself", async () => {
    const provider = scripted([{ kind: "text", text: "x".repeat(40) }, { kind: "stop", reason: "end-turn" }]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner });
    const usage = (await collect(agent.send("hello"))).find((event) => event.kind === "usage");
    expect(usage).toMatchObject({ kind: "usage", estimated: true });
    expect(usage).not.toHaveProperty("cachedTokens");
  });
});
