import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { pipeToNodeResponse } from "next/dist/server/pipe-readable.js";
import { createTagflowHandler } from "../../../services/api/src/tagflow.ts";
import { createMemoryStore } from "../../../services/api/src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../../../services/api/src/tagflowConfig.ts";
import { createOpenAiCompatibleProvider } from "../../../packages/ai/src/providers/openaiCompatible.ts";
import type { ProviderEvent } from "../../../packages/ai/src/types.ts";

const event = (raw: unknown): string => `data: ${JSON.stringify(raw)}\n\n`;
const partial = event({ choices: [{ delta: { content: "partial answer" } }] });
const chat = { model: "coder", messages: [{ role: "user", content: "Hello" }], max_tokens: 100, stream: true };

async function relay(response: () => Response) {
  const store = createMemoryStore();
  await store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 65_536, maxOutput: 4096, inputPrice: 0, outputPrice: 0 }] }, updatedAt: 0, updatedBy: "setup" });
  const upstream = vi.fn<typeof fetch>(async () => response());
  const handle = createTagflowHandler({ store, verifier: { async verify() { return { uid: "user", claims: { email: "user@example.test", email_verified: true } }; } }, clock: { now: () => Date.parse("2026-10-25T12:00:00Z") }, apiKey: "private-key", fetchImpl: upstream });
  const request = () => new Request("https://adcode.test/v1/ai/tagflow/chat/completions", { method: "POST", headers: { authorization: "Bearer user", "content-type": "application/json" }, body: JSON.stringify(chat) });
  return { store, upstream, respond: async () => (await handle(request()))! };
}

describe("included AI through the deployed Next response bridge", () => {
  it.each([
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
    'data: [DONE]',
    'data: [DONE]\r\n',
  ])("accepts a complete terminal data line without a final empty line: %s", async ending => {
    const fixture = await relay(() => new Response(partial + ending, { headers: { "content-type": "text/event-stream" } }));
    const response = await fixture.respond();
    const body = await response.text();
    expect(body).toContain("partial answer");
    expect(body).toContain(ending.trim());
    expect(body).not.toContain("stream-interrupted");
    expect(body.endsWith("\n\n")).toBe(true);
    expect(await fixture.store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome: "success" });
  });

  it.each([
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}',
    'data: {"choices":[{"delta":{"content":"unfinished"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"error"}]}',
    'data: {"choices":[{"delta":{},"finish_reason":0}]}',
    'data: {"error":{"message":"private-key provider detail"}}',
  ])("keeps incomplete or failed trailing data as an error: %s", async ending => {
    const fixture = await relay(() => new Response(partial + ending, { headers: { "content-type": "text/event-stream" } }));
    const response = await fixture.respond();
    const body = await response.text();
    expect(body).toContain("partial answer");
    expect(body).toContain("stream-interrupted");
    expect(body).not.toContain("private-key");
    expect(await fixture.store.getModelRequest(response.headers.get("x-adcode-request-id")!)).toMatchObject({ outcome: "provider_error" });
  });

  it.each(["provider error", "broken transport", "truncated response"] as const)("finishes a %s with a safe SSE error instead of rejecting Next's response pipe", async (failure) => {
    const fixture = await relay(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(partial)); },
      pull(controller) {
        if (failure === "provider error") controller.enqueue(new TextEncoder().encode(event({ error: { message: "private-key provider detail" } })));
        if (failure === "broken transport") controller.error(new Error("private-key transport detail"));
        else controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    let pipeError: unknown;
    let finished = false;
    let requestId = "";
    const server = createServer((_request, response) => {
      void (async () => {
        const upstream = await fixture.respond();
        requestId = upstream.headers.get("x-adcode-request-id") ?? "";
        response.setHeader("content-type", "text/event-stream");
        await pipeToNodeResponse(upstream.body!, response);
        finished = response.writableFinished;
      })().catch((error: unknown) => { pipeError = error; response.destroy(); });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Missing local address");
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      const text = await response.text();
      expect(text).toContain("partial answer");
      expect(text).toContain('"code":"stream-interrupted"');
      expect(text).not.toContain("private-key");
      expect(text).not.toContain("[DONE]");
      expect(pipeError).toBeUndefined();
      // pipeTo resolves in a microtask after the HTTP finish event.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(true);
      expect(await fixture.store.getTagflowUsage("user", "2026-10-25")).toMatchObject({ requests: 1, reservedTokens: 0, estimatedRequests: 1, outputTokens: 100 });
      expect(fixture.upstream).toHaveBeenCalledTimes(1);
      expect(await fixture.store.getModelRequest(requestId)).toMatchObject({ outcome: "provider_error", errorCode: failure === "truncated response" ? "incomplete-stream" : "stream-interrupted" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("makes the desktop adapter throw after partial text without emitting success or retrying the request", async () => {
    const fixture = await relay(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(partial)); },
      pull(controller) { controller.enqueue(new TextEncoder().encode(event({ error: { message: "private-key provider detail" } }))); controller.close(); },
    }), { headers: { "content-type": "text/event-stream" } }));
    const provider = createOpenAiCompatibleProvider({ id: "tagflow", displayName: "Included AI", baseUrl: "https://adcode.test/v1/ai/tagflow", apiKey: "user", models: ["coder"], fetchImpl: async () => fixture.respond() });
    const events: ProviderEvent[] = [];
    const collect = async () => {
      for await (const next of provider.stream({ model: "coder", system: "", messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], tools: [], maxTokens: 100 }, new AbortController().signal)) events.push(next);
    };
    await expect(collect()).rejects.toThrow("Included AI stream interrupted");
    expect(events).toContainEqual({ kind: "text", text: "partial answer" });
    expect(events.some((one) => one.kind === "stop")).toBe(false);
    expect(fixture.upstream).toHaveBeenCalledTimes(1);
  });
});
