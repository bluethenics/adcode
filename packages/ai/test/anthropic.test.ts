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

  it("sends no effort unless the user picked one", async () => {
    const sent: { params?: Record<string, unknown> } = {};
    const provider = createAnthropicProvider({ apiKey: "k", client: fakeClient(sent) });

    await collect(provider.stream(base, new AbortController().signal));
    expect(sent.params?.["output_config"]).toBeUndefined();

    await collect(
      provider.stream({ ...base, effort: "max" }, new AbortController().signal),
    );
    expect(sent.params?.["output_config"]).toEqual({ effort: "max" });
  });
});

/*
 * Thinking and effort, per model.
 *
 * Adaptive thinking arrived with Claude 4.6; `display` with 4.7, where the default became
 * "omitted"; effort without a beta header with 4.6. Sending any of them to an older model is a
 * 400 - which is how Claude Haiku 4.5, the cheap fast choice, failed every message.
 */
describe("thinking settings each Claude model accepts", () => {
  async function paramsFor(model: string, effort?: ProviderRequest["effort"], traits?: Parameters<typeof createAnthropicProvider>[0]["traits"]) {
    const sent: { params?: Record<string, unknown> } = {};
    const provider = createAnthropicProvider({ apiKey: "k", client: fakeClient(sent), ...(traits === undefined ? {} : { traits }) });
    await collect(provider.stream({ ...base, model, ...(effort === undefined ? {} : { effort }) }, new AbortController().signal));
    return sent.params ?? {};
  }

  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101", "claude-sonnet-4-20250514", "claude-opus-4-1", "claude-3-7-sonnet-20250219"])(
    "sends %s no thinking settings and no effort",
    async (model) => {
      const params = await paramsFor(model, "high");
      expect(params).not.toHaveProperty("thinking");
      expect(params).not.toHaveProperty("output_config");
    },
  );

  it.each(["claude-opus-4-6", "claude-sonnet-4-6"])("gives %s adaptive thinking without the 4.7 display field", async (model) => {
    const params = await paramsFor(model, "max");
    expect(params["thinking"]).toEqual({ type: "adaptive" });
    expect(params["output_config"]).toEqual({ effort: "max" });
  });

  it.each(["claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-5", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5", "claude-fable-5-1"])(
    "gives %s adaptive thinking with summarised display",
    async (model) => {
      const params = await paramsFor(model);
      expect(params["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
    },
  );

  it("clamps effort to the levels the catalogue lists for the model", async () => {
    const params = await paramsFor("claude-opus-4-6", "max", () => ({ reasoning: true, effortLevels: ["low", "medium", "high"] }));
    expect(params["output_config"]).toEqual({ effort: "high" });
  });

  it("asks again at the size Anthropic names when the model's output cap is lower", async () => {
    const sizes: number[] = [];
    const client = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          sizes.push(Number(params["max_tokens"]));
          const refuse = sizes.length === 1;
          async function* events(): AsyncIterable<Record<string, unknown>> {
            if (refuse) {
              throw new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 16384 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku-20241022"}}');
            }
            yield { type: "message_stop" };
          }
          return Object.assign(events(), { finalMessage: async () => ({ stop_reason: "end_turn", content: [] }) });
        },
      },
    } as unknown as Anthropic;
    const provider = createAnthropicProvider({ apiKey: "k", client });

    const events = await collect(provider.stream({ ...base, model: "claude-3-5-haiku-20241022", maxTokens: 16384 }, new AbortController().signal));

    expect(sizes).toEqual([16384, 8192]);
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("treats a Claude newer than this code as the newest kind", async () => {
    const params = await paramsFor("claude-opus-6", "high");
    expect(params["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
    expect(params["output_config"]).toEqual({ effort: "high" });
  });
});
