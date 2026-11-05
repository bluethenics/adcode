import { describe, expect, it } from "vitest";
import type { Provider, ProviderEvent, ProviderRequest } from "../../../packages/ai/src/index.ts";
import {
  describeChatError,
  effortFor,
  maxTokensFor,
  streamChat,
  systemPrompt,
  toMessages,
} from "../src/ai/chat.ts";
import type { BuiltProvider } from "../src/ai/provider.ts";

function builtWith(
  events: readonly ProviderEvent[],
  options: {
    capture?: ProviderRequest[];
    maxOutput?: number;
    onStream?: (request: ProviderRequest, signal: AbortSignal) => void;
  } = {},
): BuiltProvider {
  const provider = {
    stream: (request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> => {
      options.capture?.push(request);
      options.onStream?.(request, signal);
      return (async function* () {
        for (const event of events) yield event;
      })();
    },
  } as unknown as Provider;

  return {
    provider,
    selection: {
      providerId: "tagflow",
      providerName: "Included AI",
      modelId: "test-default",
      modelName: "Test Default",
      ready: true,
      reason: null,
      choice: { provider: "tagflow", model: "test-default" },
      included: true,
    },
    keySource: "included",
    model: {
      contextWindow: 131_072,
      maxOutput: options.maxOutput ?? 4_096,
      reasoning: false,
    },
  };
}

describe("streamChat - one honest reply", () => {
  it("collects text, thinking and usage as the provider streams", async () => {
    const seen: string[] = [];
    const result = await streamChat({
      built: builtWith([
        { kind: "thinking", text: "considering" },
        { kind: "status", text: "reading files" },
        { kind: "text", text: "Hel" },
        { kind: "text", text: "lo" },
        { kind: "usage", inputTokens: 10, outputTokens: 5 },
        { kind: "stop", reason: "end-turn" },
      ]),
      turns: [{ role: "user", text: "say hello" }],
      signal: new AbortController().signal,
      handlers: {
        onText: (delta) => seen.push(`text:${delta}`),
        onThinking: (delta) => seen.push(`thinking:${delta}`),
        onStatus: (text) => seen.push(`status:${text}`),
      },
    });

    expect(result).toEqual({
      text: "Hello",
      thinking: "considering",
      inputTokens: 10,
      outputTokens: 5,
      stopReason: "end-turn",
      refused: false,
      cutOff: false,
    });
    expect(seen).toEqual(["thinking:considering", "status:reading files", "text:Hel", "text:lo"]);
  });

  it("sends the selected model, the conversation and the requested limit", async () => {
    const capture: ProviderRequest[] = [];
    await streamChat({
      built: builtWith([{ kind: "stop", reason: "end-turn" }], { capture }),
      turns: [
        { role: "user", text: "first" },
        { role: "assistant", text: "answer" },
        { role: "user", text: "second" },
      ],
      signal: new AbortController().signal,
      system: "custom system",
      maxTokens: 123,
      effort: "high",
    });

    expect(capture).toHaveLength(1);
    const request = capture[0]!;
    expect(request.model).toBe("test-default");
    expect(request.system).toBe("custom system");
    expect(request.maxTokens).toBe(123);
    expect(request.effort).toBe("high");
    expect(request.tools).toEqual([]);
    expect(request.messages).toHaveLength(3);
    expect(request.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "answer" }] });
  });

  it("stops a reply when the signal is aborted", async () => {
    const controller = new AbortController();
    const result = await streamChat({
      built: builtWith(
        [
          { kind: "text", text: "first" },
          { kind: "text", text: "second" },
          { kind: "stop", reason: "end-turn" },
        ],
        { onStream: () => controller.abort() },
      ),
      turns: [{ role: "user", text: "go" }],
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("cancelled");
  });

  it("marks a refusal and a length cut-off instead of pretending they are normal", async () => {
    const refused = await streamChat({
      built: builtWith([{ kind: "stop", reason: "refusal" }]),
      turns: [{ role: "user", text: "no" }],
      signal: new AbortController().signal,
    });
    expect(refused.refused).toBe(true);
    expect(refused.cutOff).toBe(false);

    const cutOff = await streamChat({
      built: builtWith([{ kind: "stop", reason: "max-tokens" }]),
      turns: [{ role: "user", text: "long" }],
      signal: new AbortController().signal,
    });
    expect(cutOff.refused).toBe(false);
    expect(cutOff.cutOff).toBe(true);
  });

  it("uses the model's output limit without letting it exceed the terminal's budget", () => {
    expect(maxTokensFor({ maxOutput: 0 })).toBe(8_192);
    expect(maxTokensFor({ maxOutput: 500 })).toBe(500);
    expect(maxTokensFor({ maxOutput: 100_000 })).toBe(8_192);
  });
});

describe("chat vocabulary", () => {
  it("maps roles and text into provider messages", () => {
    expect(toMessages([{ role: "user", text: "hi" }])).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("passes an explicit effort through and leaves auto unset", () => {
    expect(effortFor("auto")).toBeUndefined();
    expect(effortFor("low")).toBe("low");
    expect(effortFor("max")).toBe("max");
  });

  it("tells the model it is a terminal assistant that cannot edit files", () => {
    const prompt = systemPrompt("E:\\project");
    expect(prompt).toContain("terminal coding assistant");
    expect(prompt).toContain("cannot edit files");
    expect(prompt).toContain("E:\\project");
    expect(prompt).toContain("Never invent command output");
  });
});

describe("describeChatError - a sentence somebody can act on", () => {
  it("explains a verification requirement and a rejected credential", () => {
    expect(describeChatError(new Error("account not verified"))).toContain("verified account");
    expect(describeChatError(new Error("401 unauthorized"))).toContain("rejected the credential");
  });

  it("explains rate limits and unreachable providers", () => {
    expect(describeChatError(new Error("429 too many requests"))).toContain("rate-limiting");
    expect(describeChatError(new Error("fetch failed"))).toContain("could not be reached");
  });

  it("passes through Included AI's own daily-limit explanation instead of 'wait a moment'", () => {
    const raw = "Included AI returned HTTP 429: You have 1.36 credits left today. Tagflow Code 27B uses no credits. (code daily-limit)";
    expect(describeChatError(new Error(raw))).toBe("You have 1.36 credits left today. Tagflow Code 27B uses no credits.");
    expect(describeChatError(new Error("could not generate a reply"))).not.toContain("rate-limiting");
  });

  it("prefers the selection's own reason when the model is not ready", () => {
    expect(describeChatError(new Error("boom"), { providerId: "openrouter", ready: false, reason: "Set OPENROUTER_API_KEY" }))
      .toBe("Set OPENROUTER_API_KEY");
  });

  it("never returns an empty sentence", () => {
    expect(describeChatError(new Error(""))).toBe("The model stopped without an answer.");
    expect(describeChatError("plain text")).toBe("plain text");
  });
});
