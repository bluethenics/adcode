import { describe, it, expect } from "vitest";
import { createAgent, estimateRequestTokens, MAX_TURNS } from "../src/agent.ts";
import type {
  AgentEvent,
  Provider,
  ProviderEvent,
  ToolCallBlock,
  ToolDefinition,
  ToolRunner,
} from "../src/types.ts";

/** A provider that replays scripted turns, one array of events per turn. */
function scriptedProvider(turns: ProviderEvent[][]): Provider & { requests: number } {
  let index = 0;

  const provider = {
    id: "anthropic" as const,
    displayName: "Scripted",
    models: ["test-model"],
    requests: 0,
    async *stream(): AsyncIterable<ProviderEvent> {
      provider.requests += 1;
      const turn = turns[index++] ?? [{ kind: "stop" as const, reason: "end-turn" as const }];
      for (const event of turn) yield event;
    },
  };

  return provider;
}

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the input back",
  inputSchema: { type: "object", properties: { value: { type: "string" } } },
  mutating: false,
};

function runner(impl?: Partial<ToolRunner>): ToolRunner & { calls: ToolCallBlock[] } {
  const calls: ToolCallBlock[] = [];
  return {
    calls,
    async run(call) {
      calls.push(call);
      if (impl?.run) return impl.run(call, new AbortController().signal);
      return { content: `ran ${call.name}`, isError: false };
    },
  };
}

const call = (id: string, name = "echo"): ToolCallBlock => ({
  type: "tool-call",
  id,
  name,
  input: { value: "x" },
});

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const kinds = (events: readonly AgentEvent[]): string[] => events.map((e) => e.kind);

describe("a plain turn", () => {
  it("streams text and ends", async () => {
    const provider = scriptedProvider([
      [
        { kind: "text", text: "Hello" },
        { kind: "text", text: " world" },
        { kind: "stop", reason: "end-turn" },
      ],
    ]);

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("hi"));

    expect(kinds(events)).toEqual(["text", "text", "turn-end"]);
    expect(events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text).join("")).toBe(
      "Hello world",
    );
  });

  it("surfaces the reasoning summary when the provider gives one", async () => {
    const provider = scriptedProvider([
      [
        { kind: "thinking", text: "considering options" },
        { kind: "text", text: "answer" },
        { kind: "stop", reason: "end-turn" },
      ],
    ]);

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    expect(kinds(await collect(agent.send("hi")))).toEqual(["thinking", "text", "turn-end"]);
  });
});

describe("request budget gate", () => {
  it("checks a conservative request estimate before contacting the provider", async () => {
    const provider = scriptedProvider([[{ kind: "text", text: "never" }]]);
    let estimate = 0;
    const agent = createAgent({
      provider,
      model: "test-model",
      tools: [],
      runner: runner(),
      beforeRequest: (request) => {
        estimate = estimateRequestTokens(request);
        return "Task token budget reached. Increase it or start a new task.";
      },
    });

    const events = await collect(agent.send("hello"));
    expect(estimate).toBeGreaterThanOrEqual(8_192);
    expect(provider.requests).toBe(0);
    expect(events).toEqual([
      { kind: "error", detail: "Task token budget reached. Increase it or start a new task." },
    ]);
  });

  it("includes tool schemas and conversation content in the estimate", () => {
    const base = estimateRequestTokens({
      model: "test",
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [],
      maxTokens: 100,
    });
    const withTool = estimateRequestTokens({
      model: "test",
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [echoTool],
      maxTokens: 100,
    });
    expect(withTool).toBeGreaterThan(base);
  });
});

describe("tool use", () => {
  it("executes a tool call and feeds the result back for another turn", async () => {
    const provider = scriptedProvider([
      [{ kind: "tool-call", call: call("t1") }, { kind: "stop", reason: "tool-use" }],
      [{ kind: "text", text: "done" }, { kind: "stop", reason: "end-turn" }],
    ]);

    const tools = runner();
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: tools });
    const events = await collect(agent.send("go"));

    expect(kinds(events)).toEqual(["tool-call", "tool-result", "text", "turn-end"]);
    expect(tools.calls).toHaveLength(1);
    expect(provider.requests).toBe(2);
  });

  it("runs several tool calls from one turn before continuing", async () => {
    const provider = scriptedProvider([
      [
        { kind: "tool-call", call: call("t1") },
        { kind: "tool-call", call: call("t2") },
        { kind: "stop", reason: "tool-use" },
      ],
      [{ kind: "text", text: "done" }, { kind: "stop", reason: "end-turn" }],
    ]);

    const tools = runner();
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: tools });
    await collect(agent.send("go"));

    expect(tools.calls.map((c) => c.id)).toEqual(["t1", "t2"]);
  });

  it("reports a failing tool as a result rather than aborting the turn", async () => {
    // A tool that throws must not take the conversation down with it - the model is
    // perfectly capable of reading an error and trying something else.
    const provider = scriptedProvider([
      [{ kind: "tool-call", call: call("t1") }, { kind: "stop", reason: "tool-use" }],
      [{ kind: "text", text: "recovered" }, { kind: "stop", reason: "end-turn" }],
    ]);

    const tools = runner({
      run: async () => {
        throw new Error("disk on fire");
      },
    });

    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: tools });
    const events = await collect(agent.send("go"));

    const result = events.find((e) => e.kind === "tool-result");
    expect(result).toBeDefined();
    if (result?.kind === "tool-result") {
      expect(result.isError).toBe(true);
      expect(result.content).toContain("disk on fire");
    }
    expect(kinds(events)).toContain("text");
  });

  it("refuses to call a tool that was never declared", async () => {
    const provider = scriptedProvider([
      [{ kind: "tool-call", call: call("t1", "rm_rf") }, { kind: "stop", reason: "tool-use" }],
      [{ kind: "text", text: "ok" }, { kind: "stop", reason: "end-turn" }],
    ]);

    const tools = runner();
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: tools });
    const events = await collect(agent.send("go"));

    expect(tools.calls).toHaveLength(0);
    const result = events.find((e) => e.kind === "tool-result");
    if (result?.kind === "tool-result") expect(result.isError).toBe(true);
  });

  it("stops after a bounded number of turns rather than looping forever", async () => {
    // A model that keeps calling tools must not be able to spin the loop indefinitely.
    const alwaysToolUse: ProviderEvent[][] = Array.from({ length: MAX_TURNS + 5 }, () => [
      { kind: "tool-call" as const, call: call("t") },
      { kind: "stop" as const, reason: "tool-use" as const },
    ]);

    const provider = scriptedProvider(alwaysToolUse);
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: runner() });
    const events = await collect(agent.send("go"));

    expect(provider.requests).toBeLessThanOrEqual(MAX_TURNS);
    expect(kinds(events)).toContain("turn-end");
  });
});

describe("failure containment", () => {
  // §9: "AI provider down or rate-limited - Chat and completion degrade silently.
  // Editing, terminal, and memory reads are unaffected."
  it("emits an error event rather than throwing when the provider fails", async () => {
    const provider: Provider = {
      id: "anthropic",
      displayName: "Broken",
      models: ["test-model"],
      // eslint-disable-next-line require-yield
      async *stream(): AsyncIterable<ProviderEvent> {
        throw new Error("503 upstream");
      },
    };

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("hi"));

    expect(kinds(events)).toContain("error");
    const error = events.find((e) => e.kind === "error");
    if (error?.kind === "error") expect(error.detail).toContain("503 upstream");
  });

  it("reports a refusal as its own outcome, not as an error", async () => {
    const provider = scriptedProvider([
      [{ kind: "stop", reason: "refusal", detail: "declined: cyber" }],
    ]);

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("hi"));

    expect(kinds(events)).toContain("refusal");
    expect(kinds(events)).not.toContain("error");
  });

  it("never throws out of send(), whatever the provider does", async () => {
    const provider: Provider = {
      id: "anthropic",
      displayName: "Hostile",
      models: ["test-model"],
      async *stream(): AsyncIterable<ProviderEvent> {
        yield { kind: "text", text: "partial" };
        throw new Error("connection reset mid-stream");
      },
    };

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    await expect(collect(agent.send("hi"))).resolves.toBeDefined();
  });
});

describe("cancellation", () => {
  it("stops the turn and reports it", async () => {
    const provider: Provider = {
      id: "anthropic",
      displayName: "Slow",
      models: ["test-model"],
      async *stream(_request, signal): AsyncIterable<ProviderEvent> {
        yield { kind: "text", text: "one" };
        if (signal.aborted) return;
        yield { kind: "text", text: "two" };
      },
    };

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });

    const events: AgentEvent[] = [];
    for await (const event of agent.send("hi")) {
      events.push(event);
      if (event.kind === "text") agent.cancel();
    }

    expect(kinds(events)).toContain("cancelled");
  });
});

describe("conversation history", () => {
  it("carries prior turns into the next request", async () => {
    const seen: string[] = [];
    const provider: Provider = {
      id: "anthropic",
      displayName: "Recorder",
      models: ["test-model"],
      async *stream(request): AsyncIterable<ProviderEvent> {
        seen.push(request.messages.map((m) => m.role).join(","));
        // Emits text on purpose: an assistant turn with no content is never recorded,
        // because the Messages API rejects a message whose content array is empty.
        yield { kind: "text", text: "ok" };
        yield { kind: "stop", reason: "end-turn" };
      },
    };

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    await collect(agent.send("first"));
    await collect(agent.send("second"));

    expect(seen[0]).toBe("user");
    expect(seen[1]).toBe("user,assistant,user");
  });

  it("survives a dismissed widget without losing the conversation", async () => {
    // §5.3: the chat widget "dismisses on Escape without losing the conversation."
    const provider = scriptedProvider([
      [{ kind: "text", text: "one" }, { kind: "stop", reason: "end-turn" }],
      [{ kind: "text", text: "two" }, { kind: "stop", reason: "end-turn" }],
    ]);

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    await collect(agent.send("a"));
    await collect(agent.send("b"));

    expect(agent.history()).toHaveLength(4);
  });

  it("can be cleared deliberately", async () => {
    const provider = scriptedProvider([[{ kind: "stop", reason: "end-turn" }]]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });

    await collect(agent.send("a"));
    agent.reset();

    expect(agent.history()).toHaveLength(0);
  });
});
