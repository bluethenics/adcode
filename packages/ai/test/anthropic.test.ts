import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

/** The SDK client, faked: capture the params, replay canned stream events. */
function fakeClient(sent: { params?: Record<string, unknown> }) {
  return {
    messages: {
      stream: (params: Record<string, unknown>) => {
        sent.params = params;
        async function* events(): AsyncIterable<Record<string, unknown>> {
          yield { type: "message_stop" };
        }
        return Object.assign(events(), {
          finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
        });
      },
    },
  } as unknown as Anthropic;
}

const base: ProviderRequest = {
  model: "claude-sonnet-5",
  system: "be helpful",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxTokens: 64,
};

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("anthropic message mapping", () => {
  it("sends attached images as base64 image blocks beside the text", async () => {
    const sent: { params?: Record<string, unknown> } = {};
    const provider = createAnthropicProvider({ apiKey: "k", client: fakeClient(sent) });

    const events = await collect(
      provider.stream(
        {
          ...base,
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

    const messages = sent.params?.["messages"] as Array<Record<string, unknown>>;
    const content = messages[0]?.["content"] as Array<Record<string, unknown>>;
    expect(content).toContainEqual({ type: "text", text: "what is this?" });
    expect(content).toContainEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
    });
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("keeps text-only turns free of image blocks", async () => {
    const sent: { params?: Record<string, unknown> } = {};
    const provider = createAnthropicProvider({ apiKey: "k", client: fakeClient(sent) });

    await collect(provider.stream(base, new AbortController().signal));

    const messages = sent.params?.["messages"] as Array<Record<string, unknown>>;
    const content = messages[0]?.["content"] as Array<Record<string, unknown>>;
    expect(content).toEqual([{ type: "text", text: "hi" }]);
  });
});
