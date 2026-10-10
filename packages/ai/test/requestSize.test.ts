import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.ts";
import { isRequestTooLarge, LEAN_SYSTEM, leanHistory, leanTools } from "../src/requestSize.ts";
import { RequestScheduler } from "../src/requestScheduler.ts";
import type { AgentEvent, Message, Provider, ProviderEvent, ProviderRequest, ToolDefinition } from "../src/types.ts";

const tool = (name: string): ToolDefinition => ({ name, description: name, inputSchema: { type: "object" }, mutating: false });
const result = (id: string, size: number) => ({ type: "tool-result" as const, toolCallId: id, content: "x".repeat(size), isError: false });

describe("recognising a request that is too large", () => {
  it("reads the providers' own wording", () => {
    expect(isRequestTooLarge("Groq returned HTTP 413: Request too large for model `qwen`")).toBe(true);
    expect(isRequestTooLarge("OpenAI returned HTTP 400: This model's maximum context length is 128000 tokens")).toBe(true);
    expect(isRequestTooLarge("Rate limit reached on tokens per minute (TPM): Limit 6000, Used 0, Requested 9120.")).toBe(true);
  });

  it("leaves ordinary rate limits and other errors alone", () => {
    expect(isRequestTooLarge("Rate limit reached on tokens per minute (TPM): Limit 6000, Used 5600, Requested 900.")).toBe(false);
    expect(isRequestTooLarge("Groq returned HTTP 401: Invalid API Key")).toBe(false);
  });
});

describe("lean requests", () => {
  it("keep only the core tools", () => {
    const names = leanTools(["read_file", "memory_write", "edit_file", "call_mcp", "open_preview", "fetch_url"].map(tool)).map((t) => t.name);
    expect(names).toEqual(["read_file", "edit_file", "open_preview"]);
  });

  it("trim old tool output but keep the latest step whole", () => {
    const history: Message[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "user", content: [result("a", 5000), result("b", 100)] },
      { role: "user", content: [result("c", 5000)] },
    ];
    const lean = leanHistory(history, 1500);
    const [old, small] = lean[1]!.content.filter((block) => block.type === "tool-result");
    expect(old!.content.length).toBeLessThan(1700);
    expect(old!.content).toContain("[Trimmed");
    expect(small!.content).toHaveLength(100);
    expect((lean[2]!.content[0] as { content: string }).content).toHaveLength(5000);
    expect(history[1]!.content[0]).toMatchObject({ content: "x".repeat(5000) });
  });
});

describe("the agent's fallback", () => {
  it("goes lean and asks again once when a request is refused for its size", async () => {
    const seen: ProviderRequest[] = [];
    const provider: Provider = {
      id: "groq", displayName: "Groq", models: ["m"],
      async *stream(request): AsyncIterable<ProviderEvent> {
        seen.push(request);
        if (seen.length === 1) throw new Error("Groq returned HTTP 413: Request too large. Limit 6000, Requested 7543");
        yield { kind: "text", text: "done" };
        yield { kind: "stop", reason: "end-turn" };
      },
    };
    const agent = createAgent({ provider, model: "m", tools: ["read_file", "memory_write"].map(tool), runner: { run: async () => ({ content: "", isError: false }) } });
    const events: AgentEvent[] = [];
    for await (const event of agent.send("make a website")) events.push(event);

    // The refused request cost nothing, so only the one that answered is counted.
    expect(events.map((event) => event.kind)).toEqual(["status", "text", "usage", "turn-end"]);
    expect(seen[0]!.tools.map((t) => t.name)).toEqual(["read_file", "memory_write"]);
    expect(seen[1]!.tools.map((t) => t.name)).toEqual(["read_file"]);
    expect(seen[1]!.system.startsWith(LEAN_SYSTEM)).toBe(true);

    // It stays lean for the rest of the conversation, and forgets on reset.
    for await (const _ of agent.send("next")) { /* drain */ }
    expect(seen[2]!.tools).toHaveLength(1);
    agent.reset();
    for await (const _ of agent.send("fresh")) { /* drain */ }
    expect(seen[3]!.tools).toHaveLength(2);
  });

  it("does not retry a second time", async () => {
    let calls = 0;
    const provider: Provider = {
      id: "groq", displayName: "Groq", models: ["m"],
      async *stream(): AsyncIterable<ProviderEvent> { calls += 1; throw new Error("HTTP 413: Request too large"); },
    };
    const agent = createAgent({ provider, model: "m", tools: [tool("read_file")], runner: { run: async () => ({ content: "", isError: false }) } });
    const events: AgentEvent[] = [];
    for await (const event of agent.send("hi")) events.push(event);
    expect(calls).toBe(2);
    expect(events.at(-1)).toMatchObject({ kind: "error" });
  });
});

describe("rate limits that can never be waited out", () => {
  it("fail at once instead of cooling down", async () => {
    let attempts = 0;
    const provider: Provider = {
      id: "groq", displayName: "Groq", models: [],
      async *stream(): AsyncIterable<ProviderEvent> {
        attempts += 1;
        throw Object.assign(new Error("Groq returned HTTP 429: tokens per minute (TPM): Limit 6000, Used 0, Requested 9120"), { status: 429, retryAfter: "30" });
      },
    };
    const started = Date.now();
    const stream = new RequestScheduler().wrap(provider, "groq", () => 6000).stream({ model: "m", system: "", messages: [], tools: [], maxTokens: 1 }, new AbortController().signal);
    await expect((async () => { for await (const _ of stream) { /* drain */ } })()).rejects.toThrow(/Requested 9120/);
    expect(attempts).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
