import { describe, it, expect } from "vitest";
import { createAgent, estimateRequestTokens, MAX_TURNS } from "../src/agent.ts";
import type {
  AgentEvent,
  Message,
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
  it("refreshes host context without persisting it in conversation history", async () => {
    let context = "Open workspace: /first";
    const systems: string[] = [];
    const agent = createAgent({
      provider: scriptedProvider([]), model: "test", tools: [], runner: runner(),
      context: () => context,
      beforeRequest: request => { systems.push(request.system); return null; },
    });
    await collect(agent.send("first"));
    context = "Open workspace: /second";
    await collect(agent.send("second"));
    expect(systems[0]).toContain("Open workspace: /first");
    expect(systems[1]).toContain("Open workspace: /second");
    expect(systems[1]).not.toContain("Open workspace: /first");
    expect(JSON.stringify(agent.history())).not.toContain("Open workspace:");
    expect(systems[0]).toContain("coding assistant built into ADCode");
  });
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

    // Every answered request reports what it cost, after its output and before the turn ends.
    expect(kinds(events)).toEqual(["text", "text", "usage", "turn-end"]);
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
    expect(kinds(await collect(agent.send("hi")))).toEqual(["thinking", "text", "usage", "turn-end"]);
  });
});

describe("usage", () => {
  it("passes on the provider's own count when it gives one", async () => {
    const provider = scriptedProvider([
      [
        { kind: "text", text: "answer" },
        { kind: "usage", inputTokens: 1200, outputTokens: 34 },
        { kind: "stop", reason: "end-turn" },
      ],
    ]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("hi"));
    expect(events.filter((event) => event.kind === "usage")).toEqual([
      { kind: "usage", inputTokens: 1200, outputTokens: 34, estimated: false },
    ]);
  });

  it("counts a request itself, and says so, when the provider is silent", async () => {
    const provider = scriptedProvider([[{ kind: "text", text: "x".repeat(400) }, { kind: "stop", reason: "end-turn" }]]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const usage = (await collect(agent.send("hi"))).find((event) => event.kind === "usage");
    expect(usage).toMatchObject({ kind: "usage", outputTokens: 100, estimated: true });
    expect((usage as { inputTokens: number }).inputTokens).toBeGreaterThan(0);
  });

  it("does not count a request the provider refused before answering", async () => {
    const provider: Provider = {
      id: "anthropic",
      displayName: "Refusing",
      models: ["test-model"],
      async *stream(): AsyncIterable<ProviderEvent> {
        throw new Error("HTTP 401 invalid api key");
      },
    };
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("hi"));
    expect(kinds(events)).toContain("error");
    expect(kinds(events)).not.toContain("usage");
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

    expect(kinds(events)).toEqual(["tool-call", "usage", "tool-result", "text", "usage", "turn-end"]);
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
    expect(events.at(-1)).toMatchObject({ kind: "error" });
    expect(kinds(events)).not.toContain("turn-end");
  });
  it("stops identical failed calls early and keeps their results in history", async () => {
    const provider = scriptedProvider(Array.from({ length: 10 }, (_, i) => [
      { kind: "tool-call" as const, call: call(String(i)) },
      { kind: "stop" as const, reason: "tool-use" as const },
    ]));
    const tools = runner({ run: async () => ({ content: "Service is unavailable", isError: true }) });
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: tools });
    const events = await collect(agent.send("go"));
    expect(tools.calls).toHaveLength(3);
    expect(provider.requests).toBe(3);
    expect(events.at(-1)).toMatchObject({ kind: "error", detail: expect.stringContaining("three identical") });
    expect(agent.history().at(-1)?.content[0]).toMatchObject({ type: "tool-result", isError: true });
  });
  it("does not report an output-token cutoff as a successful completion", async () => {
    const cut: ProviderEvent[] = [{ kind: "text", text: "Partial answer" }, { kind: "stop", reason: "max-tokens" }];
    const provider = scriptedProvider([cut, cut, cut, cut, cut]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const events = await collect(agent.send("go"));
    expect(events.at(-1)).toMatchObject({ kind: "error", detail: expect.stringContaining("response limit") });
    expect(kinds(events)).not.toContain("turn-end");
  });
});

/**
 * The output limit, handled where it happens.
 *
 * Reported: Vibe kept answering "I stopped at a limit before finishing... Continue", and
 * Continue changed nothing. Each request allowed 8,192 output tokens, which most providers
 * share with the model's hidden reasoning; a reasoning model spent it all thinking, wrote
 * nothing, and Continue sent the same doomed request again. Now a cut-off reply carries on
 * by itself with more room, a reply that was all thinking is asked again with more room,
 * and only a limit that more room cannot fix reaches the person - saying which it was.
 */
describe("the output limit", () => {
  function recordingProvider(turns: ProviderEvent[][]): Provider & { budgets: number[]; histories: Message[][] } {
    let index = 0;
    const provider = {
      id: "anthropic" as const,
      displayName: "Recording",
      models: ["test-model"],
      budgets: [] as number[],
      histories: [] as Message[][],
      async *stream(request: { maxTokens: number; messages: readonly Message[] }): AsyncIterable<ProviderEvent> {
        provider.budgets.push(request.maxTokens);
        provider.histories.push([...request.messages]);
        const turn = turns[index++] ?? [{ kind: "stop" as const, reason: "end-turn" as const }];
        for (const event of turn) yield event;
      },
    };
    return provider;
  }

  it("continues a reply the limit cut off, by itself and with more room", async () => {
    const provider = recordingProvider([
      [{ kind: "text", text: "Part one" }, { kind: "stop", reason: "max-tokens" }],
      [{ kind: "text", text: " and part two." }, { kind: "stop", reason: "end-turn" }],
    ]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner(), maxTokens: 1000, maxOutputTokens: 8000 });

    const events = await collect(agent.send("write it"));

    expect(events.at(-1)).toEqual({ kind: "turn-end", reason: "end-turn" });
    expect(events.filter((event) => event.kind === "text").map((event) => (event as { text: string }).text).join("")).toBe("Part one and part two.");
    expect(provider.budgets).toEqual([1000, 2000]);
    // The second request ends with a note asking for the rest, after the cut-off text.
    const second = provider.histories[1]!;
    expect(second.at(-2)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Part one" }] });
    expect(JSON.stringify(second.at(-1))).toMatch(/cut off by the output limit/);
  });

  it("asks again with more room when the model spent everything thinking", async () => {
    const provider = recordingProvider([
      [{ kind: "thinking", text: "Planning the whole game..." }, { kind: "stop", reason: "max-tokens" }],
      [{ kind: "text", text: "Built it." }, { kind: "stop", reason: "end-turn" }],
    ]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner(), maxTokens: 1000, maxOutputTokens: 8000 });

    const events = await collect(agent.send("build a racing game"));

    expect(events.at(-1)).toEqual({ kind: "turn-end", reason: "end-turn" });
    expect(provider.budgets).toEqual([1000, 2000]);
    // Nothing was written, so nothing was added: the same question, asked with more room.
    expect(provider.histories[1]).toEqual(provider.histories[0]);
  });

  it("says thinking filled the allowance when even the largest one was not enough", async () => {
    const thinking: ProviderEvent[] = [{ kind: "thinking", text: "..." }, { kind: "stop", reason: "max-tokens" }];
    const provider = recordingProvider([thinking, thinking, thinking, thinking]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner(), maxTokens: 1000, maxOutputTokens: 2000 });

    const events = await collect(agent.send("go"));

    expect(provider.budgets).toEqual([1000, 2000]);
    const last = events.at(-1);
    expect(last).toMatchObject({ kind: "error" });
    expect(last?.kind === "error" ? last.detail : "").toMatch(/thinking/i);
    // Not the response-limit wording: Continue cannot fix this, so it must not offer it.
    expect(last?.kind === "error" ? last.detail : "").not.toMatch(/response limit/);
  });

  it("gives a cut-off tool call more room on the next request", async () => {
    const provider = recordingProvider([
      [
        { kind: "tool-call", call: { ...call("c1"), input: {}, inputError: "Tool not run: the model's response limit cut off the tool arguments." } },
        { kind: "stop", reason: "max-tokens" },
      ],
      [{ kind: "text", text: "Done." }, { kind: "stop", reason: "end-turn" }],
    ]);
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: runner(), maxTokens: 1000, maxOutputTokens: 8000 });

    await collect(agent.send("write the file"));

    expect(provider.budgets).toEqual([1000, 2000]);
  });

  it("never asks for more than the model's ceiling", async () => {
    const cut: ProviderEvent[] = [{ kind: "text", text: "more" }, { kind: "stop", reason: "max-tokens" }];
    const provider = recordingProvider([cut, cut, cut, cut]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner(), maxTokens: 1000, maxOutputTokens: 3000 });

    await collect(agent.send("go"));

    expect(provider.budgets).toEqual([1000, 2000, 3000, 3000]);
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

  it("honors an already-aborted external Team lane signal before contacting the provider", async () => {
    const provider = scriptedProvider([[{ kind: "text", text: "must not run" }]]);
    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const controller = new AbortController();
    controller.abort();

    const events = await collect(agent.send("hi", { signal: controller.signal }));
    expect(provider.requests).toBe(0);
    expect(kinds(events)).toEqual(["cancelled"]);
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

  it("rides attached images with the turn that attached them, ahead of the text", async () => {
    const seen: Message[] = [];
    const provider: Provider = {
      id: "anthropic",
      displayName: "Recorder",
      models: ["test-model"],
      async *stream(request): AsyncIterable<ProviderEvent> {
        seen.push(...request.messages);
        yield { kind: "text", text: "ok" };
        yield { kind: "stop", reason: "end-turn" };
      },
    };

    const agent = createAgent({ provider, model: "test-model", tools: [], runner: runner() });
    const image = { type: "image" as const, mediaType: "image/png" as const, data: "aGVsbG8=" };
    await collect(agent.send("what is this?", { images: [image] }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.content).toEqual([image, { type: "text", text: "what is this?" }]);
  });

  it("counts image bytes as a flat allowance in the token estimate, not as text", async () => {
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

    const image = {
      type: "image" as const,
      mediaType: "image/png" as const,
      data: "a".repeat(3_000_000),
    };
    await collect(agent.send("look", { images: [image] }));

    // Three megabytes of base64 as text would reserve a million tokens.
    expect(estimate).toBeLessThan(50_000);
    expect(estimate).toBeGreaterThanOrEqual(8_192);
  });

  it("tells the model to do the work with tools instead of interviewing the user", async () => {
    let system = "";
    const agent = createAgent({
      provider: scriptedProvider([]),
      model: "test-model",
      tools: [],
      runner: runner(),
      beforeRequest: (request) => {
        system = request.system;
        return null;
      },
    });
    await collect(agent.send("list the images in a folder into a file"));

    expect(system).toContain("Do the work first");
    expect(system).toContain("glob_files");
    expect(system).toContain("propose_edit");
    expect(system).toContain("Asking for anything you could");
    // Claims about files need evidence, whichever way the host applies edits.
    expect(system).toContain("Report a file as created or changed only when a tool result confirms it");
  });

  it("carries the chosen effort into the provider request, or nothing on Auto", async () => {
    const efforts: Array<string | undefined> = [];
    const agent = createAgent({
      provider: scriptedProvider([]),
      model: "test-model",
      tools: [],
      runner: runner(),
      effort: "high",
      beforeRequest: (request) => {
        efforts.push(request.effort);
        return null;
      },
    });
    await collect(agent.send("think hard"));

    expect(efforts).toEqual(["high"]);

    const plain: Array<string | undefined> = [];
    const auto = createAgent({
      provider: scriptedProvider([]),
      model: "test-model",
      tools: [],
      runner: runner(),
      beforeRequest: (request) => {
        plain.push(request.effort);
        return null;
      },
    });
    await collect(auto.send("think normally"));

    expect(plain).toEqual([undefined]);
  });
});

describe("a turn that fails mid tool call", () => {
  it("answers the open call before the next message, so the conversation stays usable", async () => {
    const seen: Message[][] = [];
    let attempt = 0;
    const provider: Provider = {
      id: "groq",
      displayName: "Flaky",
      models: ["test-model"],
      async *stream(request): AsyncIterable<ProviderEvent> {
        seen.push([...request.messages]);
        attempt += 1;
        if (attempt === 1) {
          yield { kind: "text", text: "Let me look at the folder." };
          yield { kind: "tool-call", call: call("open-1") };
          throw new Error("Groq returned HTTP 429: Rate limit reached");
        }
        yield { kind: "text", text: "Done." };
        yield { kind: "stop", reason: "end-turn" };
      },
    };
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: runner() });

    const first = await collect(agent.send("make a website"));
    expect(first.some((event) => event.kind === "error")).toBe(true);

    const second = await collect(agent.send("try again"));
    expect(second.at(-1)).toMatchObject({ kind: "turn-end" });

    // The retry carries a result for the call the failure left open, ahead of the new text.
    const retry = seen[1]!;
    const opener = retry.at(-2)!;
    expect(opener.role).toBe("assistant");
    expect(opener.content.some((block) => block.type === "tool-call" && block.id === "open-1")).toBe(true);
    const next = retry.at(-1)!;
    expect(next.role).toBe("user");
    expect(next.content[0]).toMatchObject({ type: "tool-result", toolCallId: "open-1", isError: true });
    expect(next.content.at(-1)).toMatchObject({ type: "text", text: "try again" });
  });

  it("adds nothing when the last turn finished normally", async () => {
    const provider = scriptedProvider([[{ kind: "text", text: "hi" }, { kind: "stop", reason: "end-turn" }]]);
    const agent = createAgent({ provider, model: "test-model", tools: [echoTool], runner: runner() });
    await collect(agent.send("hello"));
    await collect(agent.send("again"));
    const last = agent.history().filter((message) => message.role === "user").at(-1)!;
    expect(last.content).toEqual([{ type: "text", text: "again" }]);
  });
});
