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

  it("sends attached images as inlineData parts", async () => {
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
            {
              role: "user",
              content: [
                { type: "image", mediaType: "image/jpeg", data: "aGVsbG8=" },
                { type: "text", text: "what is this?" },
              ],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    const contents = body["contents"] as Array<Record<string, unknown>>;
    const parts = contents[0]?.["parts"] as Array<Record<string, unknown>>;
    expect(parts).toContainEqual({
      inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" },
    });
    expect(parts).toContainEqual({ text: "what is this?" });
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

/** Captures the parsed request body and answers with the given stream lines. */
function capture(lines: string[], into: { body?: Record<string, unknown> }): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    into.body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return sseFetch(lines)("", init);
  }) as unknown as typeof fetch;
}

function declarations(body: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const tools = (body?.["tools"] ?? []) as Array<Record<string, unknown>>;
  return (tools[0]?.["functionDeclarations"] ?? []) as Array<Record<string, unknown>>;
}

type Parts = Array<{ role: string; parts: Array<Record<string, unknown>> }>;

describe("tool schemas Gemini accepts", () => {
  // Gemini reads a subset of OpenAPI 3.0 into a protobuf. A keyword it has no field for -
  // additionalProperties above all - fails the whole request with HTTP 400 before the
  // model reads a word, so one strict tool schema broke every chat that offered tools.
  it("drops additionalProperties and $schema at every depth", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      tools: [{
        name: "open_preview",
        description: "d",
        mutating: false,
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          additionalProperties: false,
          properties: {
            nested: { type: "object", additionalProperties: { type: "string" }, properties: { a: { type: "string" } } },
            list: { type: "array", items: { type: "object", additionalProperties: false, properties: { b: { type: "integer" } } } },
          },
        },
      }],
    }, new AbortController().signal));

    const text = JSON.stringify(declarations(seen.body));
    expect(text).not.toContain("additionalProperties");
    expect(text).not.toContain("$schema");
    expect(text).toContain("\"b\"");
  });

  it("turns const into a one-value enum, a nullable type array into nullable, and oneOf into anyOf", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      tools: [{
        name: "t",
        description: "d",
        mutating: false,
        inputSchema: {
          type: "object",
          properties: {
            mode: { const: "fast" },
            label: { type: ["string", "null"], description: "maybe" },
            choice: { oneOf: [{ type: "string" }, { type: "integer" }] },
          },
        },
      }],
    }, new AbortController().signal));

    const parameters = declarations(seen.body)[0]?.["parameters"] as Record<string, Record<string, Record<string, unknown>>>;
    expect(parameters["properties"]?.["mode"]).toEqual({ type: "string", enum: ["fast"] });
    expect(parameters["properties"]?.["label"]).toEqual({ type: "string", nullable: true, description: "maybe" });
    expect(parameters["properties"]?.["choice"]).toEqual({ anyOf: [{ type: "string" }, { type: "integer" }] });
  });
});

describe("failures that say why", () => {
  it("carries Google's own message, not just the status", async () => {
    const failing = (async () => new Response(JSON.stringify({
      error: { code: 400, message: "Invalid JSON payload received. Unknown name \"foo\"", status: "INVALID_ARGUMENT" },
    }), { status: 400 })) as unknown as typeof fetch;
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: failing });
    await expect(collect(provider.stream(request, new AbortController().signal)))
      .rejects.toThrow(/HTTP 400.*Invalid JSON payload received/);
  });

  it("reports an error the stream carries instead of ending silently", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([`data: ${JSON.stringify({ error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } })}`]),
    });
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toThrow(/Resource has been exhausted/);
  });
});

describe("thought signatures (Gemini 3)", () => {
  // Gemini 3 rejects the request after a tool call with "Function call is missing a
  // thought_signature" unless each signature it sent comes back on its own part.
  it("keeps the signature that arrives with a function call", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([
        candidate([{ functionCall: { name: "read_file", args: { path: "a" } }, thoughtSignature: "sig-1" }]),
        candidate([], "STOP"),
      ]),
    });
    const events = await collect(provider.stream({ ...request, model: "gemini-3.5-flash" }, new AbortController().signal));
    const call = events.find((event) => event.kind === "tool-call");
    expect(call?.kind === "tool-call" ? call.call.signature : undefined).toBe("sig-1");
  });

  it("sends each signature back on its function call", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      model: "gemini-3.5-flash",
      messages: [
        { role: "user", content: [{ type: "text", text: "read a" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "read_file", input: { path: "a" }, signature: "sig-1" }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "A", isError: false }] },
      ],
    }, new AbortController().signal));

    const contents = seen.body?.["contents"] as Parts;
    expect(contents[1]?.parts[0]).toMatchObject({ functionCall: { name: "read_file", args: { path: "a" } }, thoughtSignature: "sig-1" });
  });

  it("marks a call another model made, so Gemini 3 accepts the history", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      model: "gemini-flash-latest",
      messages: [
        { role: "user", content: [{ type: "text", text: "read a" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "toolu_1", name: "read_file", input: { path: "a" } }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "toolu_1", content: "A", isError: false }] },
      ],
    }, new AbortController().signal));

    const contents = seen.body?.["contents"] as Parts;
    expect(contents[1]?.parts[0]?.["thoughtSignature"]).toBe("skip_thought_signature_validator");
  });

  it("leaves Gemini 2.5 histories without invented signatures", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: [{ type: "text", text: "read a" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "toolu_1", name: "read_file", input: { path: "a" } }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "toolu_1", content: "A", isError: false }] },
      ],
    }, new AbortController().signal));

    const contents = seen.body?.["contents"] as Parts;
    expect(contents[1]?.parts[0]).not.toHaveProperty("thoughtSignature");
  });
});

describe("parallel calls to one tool", () => {
  it("gives each call its own id", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([
        candidate([
          { functionCall: { name: "read_file", args: { path: "a" } } },
          { functionCall: { name: "read_file", args: { path: "b" } } },
        ]),
        candidate([], "STOP"),
      ]),
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    const ids = events.flatMap((event) => event.kind === "tool-call" ? [event.call.id] : []);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps the id Google gives a call, marked as Google's", async () => {
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: sseFetch([candidate([{ functionCall: { id: "abc", name: "read_file", args: {} } }]), candidate([], "STOP")]),
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    const call = events.find((event) => event.kind === "tool-call");
    expect(call?.kind === "tool-call" ? call.call.id : undefined).toBe("gemini:abc");
  });

  it("answers each call by its function name, and by Google's id when it gave one", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      messages: [
        { role: "user", content: [{ type: "text", text: "read a and b" }] },
        {
          role: "assistant",
          content: [
            { type: "tool-call", id: "gemini:g-abc", name: "read_file", input: { path: "a" } },
            { type: "tool-call", id: "adcode-gemini-2", name: "read_file", input: { path: "b" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool-result", toolCallId: "gemini:g-abc", content: "A", isError: false },
            { type: "tool-result", toolCallId: "adcode-gemini-2", content: "B", isError: false },
          ],
        },
      ],
    }, new AbortController().signal));

    const contents = seen.body?.["contents"] as Parts;
    expect(contents[1]?.parts[0]?.["functionCall"]).toEqual({ name: "read_file", args: { path: "a" }, id: "g-abc" });
    expect(contents[1]?.parts[1]?.["functionCall"]).toEqual({ name: "read_file", args: { path: "b" } });
    expect(contents[2]?.parts[0]?.["functionResponse"]).toEqual({ name: "read_file", id: "g-abc", response: { result: "A" } });
    expect(contents[2]?.parts[1]?.["functionResponse"]).toEqual({ name: "read_file", response: { result: "B" } });
  });

  it("never sends another provider's call id to Google", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({
      ...request,
      messages: [
        { role: "user", content: [{ type: "text", text: "read a" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "aB3dE5gH7", name: "read_file", input: { path: "a" } }] },
        { role: "user", content: [{ type: "tool-result", toolCallId: "aB3dE5gH7", content: "A", isError: false }] },
      ],
    }, new AbortController().signal));

    const contents = seen.body?.["contents"] as Parts;
    expect(contents[1]?.parts[0]?.["functionCall"]).toEqual({ name: "read_file", args: { path: "a" } });
    expect(contents[2]?.parts[0]?.["functionResponse"]).toEqual({ name: "read_file", response: { result: "A" } });
  });
});

describe("thinking", () => {
  it("asks a thinking model for its thoughts, at the nearest level the model offers", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: capture([candidate([], "STOP")], seen),
      traits: (model) => model === "gemini-3.5-flash" ? { reasoning: true, effortLevels: ["low", "medium", "high"] } : undefined,
    });
    await collect(provider.stream({ ...request, model: "gemini-3.5-flash", effort: "max" }, new AbortController().signal));
    expect((seen.body?.["generationConfig"] as Record<string, unknown>)["thinkingConfig"])
      .toEqual({ includeThoughts: true, thinkingLevel: "high" });
  });

  it("asks a thinking model for its thoughts when no effort is chosen", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({
      apiKey: "k",
      fetchImpl: capture([candidate([], "STOP")], seen),
      traits: () => ({ reasoning: true, effortLevels: ["low", "high"] }),
    });
    await collect(provider.stream({ ...request, model: "gemini-3.5-pro" }, new AbortController().signal));
    expect((seen.body?.["generationConfig"] as Record<string, unknown>)["thinkingConfig"]).toEqual({ includeThoughts: true });
  });

  it("sends no thinking settings to a model the catalogue does not call a thinker", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const provider = createGoogleProvider({ apiKey: "k", fetchImpl: capture([candidate([], "STOP")], seen) });
    await collect(provider.stream({ ...request, model: "gemini-2.0-flash", effort: "high" }, new AbortController().signal));
    expect(seen.body?.["generationConfig"]).not.toHaveProperty("thinkingConfig");
  });
});
