import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAgent } from "../src/agent.ts";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { createOpenAiProvider } from "../src/providers/openaiCompatible.ts";
import type { AgentEvent, Provider, ProviderEvent, ProviderRequest } from "../src/types.ts";
import { PROPOSE_EDIT } from "../src/tools.ts";

const request: ProviderRequest = {
  model: "m",
  system: "s",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxTokens: 64,
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const inputs = (events: readonly ProviderEvent[]) => events.filter((event) => event.kind === "tool-input");

describe("providers pass tool arguments through as they stream", () => {
  it("Anthropic yields each input_json_delta, in order, before the finished call", async () => {
    const client = {
      messages: {
        stream: () => {
          async function* events(): AsyncIterable<Record<string, unknown>> {
            yield { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "propose_edit", input: {} } };
            yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"a.ts",' } };
            yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"contents":"x"}' } };
            yield { type: "content_block_stop", index: 1 };
            yield { type: "message_stop" };
          }
          return Object.assign(events(), { finalMessage: async () => ({ stop_reason: "tool_use", content: [] }) });
        },
      },
    } as unknown as Anthropic;
    const events = await collect(createAnthropicProvider({ apiKey: "k", client }).stream(request, new AbortController().signal));

    expect(inputs(events)).toEqual([
      { kind: "tool-input", index: 1, id: "t1", name: "propose_edit", fragment: '{"path":"a.ts",' },
      { kind: "tool-input", index: 1, id: "t1", name: "propose_edit", fragment: '"contents":"x"}' },
    ]);
    expect(events.findIndex((event) => event.kind === "tool-call")).toBeGreaterThan(events.findLastIndex((event) => event.kind === "tool-input"));
  });

  it("OpenAI-compatible yields each arguments delta, carrying the id the first one named", async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "propose_edit", arguments: '{"pa' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
    ];
    const fetchLines = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(`${line}\n`));
        controller.close();
      },
    }))) as unknown as typeof fetch;
    const events = await collect(createOpenAiProvider("key", fetchLines).stream(request, new AbortController().signal));

    expect(inputs(events)).toEqual([
      { kind: "tool-input", index: 0, id: "c1", name: "propose_edit", fragment: '{"pa' },
      { kind: "tool-input", index: 0, id: "c1", name: "propose_edit", fragment: 'th":"a.ts"}' },
    ]);
  });
});

describe("the agent loop turns streamed arguments into live drafts", () => {
  function provider(turns: ProviderEvent[][], seen: ProviderRequest[]): Provider {
    let index = 0;
    return {
      id: "anthropic",
      displayName: "Scripted",
      models: ["m"],
      async *stream(sent) {
        seen.push(sent);
        for (const event of turns[index++] ?? [{ kind: "stop", reason: "end-turn" }]) yield event;
      },
    };
  }

  it("yields tool-draft events before the call, and never keeps them in the conversation", async () => {
    const seen: ProviderRequest[] = [];
    const agent = createAgent({
      provider: provider([
        [
          { kind: "tool-input", index: 0, id: "t1", name: "propose_edit", fragment: '{"path":"a.ts","contents":"one\\n' },
          { kind: "tool-input", index: 0, id: "t1", name: "propose_edit", fragment: 'two"}' },
          { kind: "tool-call", call: { type: "tool-call", id: "t1", name: "propose_edit", input: { path: "a.ts", contents: "one\ntwo" } } },
          { kind: "stop", reason: "tool-use" },
        ],
        [{ kind: "text", text: "done" }, { kind: "stop", reason: "end-turn" }],
      ], seen),
      model: "m",
      tools: [PROPOSE_EDIT],
      runner: { run: async () => ({ content: "written", isError: false }) },
    });

    const events = await collect(agent.send("write it"));
    const drafts = events.filter((event): event is Extract<AgentEvent, { kind: "tool-draft" }> => event.kind === "tool-draft");

    expect(drafts.map((draft) => draft.append).join("")).toBe("one\ntwo");
    expect(drafts.every((draft) => draft.id === "t1" && draft.name === "propose_edit")).toBe(true);
    expect(drafts.at(-1)?.path).toBe("a.ts");
    expect(events.findIndex((event) => event.kind === "tool-call")).toBeGreaterThan(events.findLastIndex((event) => event.kind === "tool-draft"));
    expect(JSON.stringify(seen[1]?.messages)).not.toContain("tool-draft");
  });

  it("does not draft tools that write no code", async () => {
    const agent = createAgent({
      provider: provider([
        [
          { kind: "tool-input", index: 0, id: "r1", name: "read_file", fragment: '{"path":"a.ts"}' },
          { kind: "tool-call", call: { type: "tool-call", id: "r1", name: "read_file", input: { path: "a.ts" } } },
          { kind: "stop", reason: "tool-use" },
        ],
      ], []),
      model: "m",
      tools: [],
      runner: { run: async () => ({ content: "text", isError: false }) },
    });

    const events = await collect(agent.send("read it"));
    expect(events.some((event) => event.kind === "tool-draft")).toBe(false);
  });
});
