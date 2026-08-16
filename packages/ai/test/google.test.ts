import { describe, it, expect } from "vitest";
import { createGoogleProvider } from "../src/providers/google.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

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
  model: "gemini-2.5-pro",
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

const candidate = (parts: unknown[], finishReason?: string): string =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }] })}`;

describe("streaming", () => {
  it("yields text parts", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([candidate([{ text: "Hello" }]), candidate([], "STOP")]),
    });

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.some((e) => e.kind === "text")).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("routes a thought part to the trace rather than the reply", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([candidate([{ text: "weighing", thought: true }]), candidate([], "STOP")]),
    });

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events[0]).toEqual({ kind: "thinking", text: "weighing" });
  });

  it("reads a function call", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([
        candidate([{ functionCall: { name: "read_file", args: { path: "a.ts" } } }]),
        candidate([], "STOP"),
      ]),
    });

    const events = await collect(provider.stream(request, new AbortController().signal));
    const call = events.find((e) => e.kind === "tool-call");

    if (call?.kind === "tool-call") {
      expect(call.call.name).toBe("read_file");
      expect(call.call.input).toEqual({ path: "a.ts" });
    }
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "tool-use" });
  });

  it("maps a safety stop to a refusal", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([candidate([], "SAFETY")]),
    });

    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ kind: "stop", reason: "refusal" });
  });

  it("throws on a non-200 so the agent loop reports it", async () => {
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: sseFetch([], 403) });
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toThrow(/403/);
  });
});

describe("request shape", () => {
  it("sends the key as a header, never in the URL", async () => {
    // A key in a query string ends up in proxy logs and crash reports.
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};

    const capturing = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      return sseFetch([candidate([], "STOP")])("", init);
    }) as unknown as typeof fetch;

    const provider = createGoogleProvider({ apiKey: "secret-key", fetchImpl: capturing });
    await collect(provider.stream(request, new AbortController().signal));

    expect(seenUrl).not.toContain("secret-key");
    expect(seenHeaders["x-goog-api-key"]).toBe("secret-key");
  });

  it("puts the system prompt in systemInstruction, not in contents", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([candidate([], "STOP")])("", init);
    }) as unknown as typeof fetch;

    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capturing });
    await collect(provider.stream(request, new AbortController().signal));

    expect(body["systemInstruction"]).toBeDefined();
    const contents = body["contents"] as Array<Record<string, unknown>>;
    expect(contents.every((c) => c["role"] !== "system")).toBe(true);
  });

  it("renames the assistant role to model", async () => {
    let body: Record<string, unknown> = {};

    const capturing = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sseFetch([candidate([], "STOP")])("", init);
    }) as unknown as typeof fetch;

    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capturing });
    await collect(
      provider.stream(
        {
          ...request,
          messages: [
            { role: "user", content: [{ type: "text", text: "a" }] },
            { role: "assistant", content: [{ type: "text", text: "b" }] },
          ],
        },
        new AbortController().signal,
      ),
    );

    const contents = body["contents"] as Array<Record<string, unknown>>;
    expect(contents.map((c) => c["role"])).toEqual(["user", "model"]);
  });
});
