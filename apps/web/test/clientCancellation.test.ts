import { describe, expect, it, vi } from "vitest";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import cloudflareWrapper from "../node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js";
import { withClientCancellation } from "../src/lib/clientCancellation.ts";

async function beforeHeadersFixture(path = "/v1/ai/tagflow/chat/completions") {
  let started: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let cleaned = false;
  const background: Promise<unknown>[] = [];
  const run = await cloudflareWrapper.wrapper(async (_event, options) => {
    // Model the route's cleanup after OpenNext destroys its Node response on abort,
    // before that response has called streamCreator.writeHeaders.
    await new Promise<void>(resolve => { options?.streamCreator?.abortSignal?.addEventListener("abort", () => resolve(), { once: true }); started(); });
    cleaned = true;
    return { type: "core", statusCode: 499, headers: {}, body: new NodeReadableStream({ start(controller) { controller.close(); } }), isBase64Encoded: false };
  }, {
    name: "fixture-edge",
    async convertFrom(request: Request) { return { type: "core", method: request.method, rawPath: path, url: request.url, body: Buffer.from("{}"), headers: {}, remoteAddress: "127.0.0.1", query: {}, cookies: {} }; },
    async convertTo(result) { return result; },
  });
  const abort = new AbortController();
  const request = new Request(`https://adcode.test${path}`, { method: "POST", body: "{}", signal: abort.signal });
  return { abort, request, ready, background, cleaned: () => cleaned,
    respond: () => run(request, {}, { waitUntil(task: Promise<unknown>) { background.push(task); } }, request.signal) as Promise<Response> };
}

describe("client cancellation before OpenNext writes response headers", () => {
  it("reproduces the installed adapter's unresolved fetch promise after disconnect", async () => {
    const fixture = await beforeHeadersFixture();
    const response = fixture.respond();
    await fixture.ready;
    fixture.abort.abort();
    await Promise.all(fixture.background);
    expect(fixture.cleaned()).toBe(true);
    expect(await Promise.race([response.then(() => "returned"), new Promise(resolve => setTimeout(() => resolve("pending"), 20))])).toBe("pending");
  });

  it.each(["/v1/ai/tagflow/chat/completions", "/docs/updates-auto", "/v1/webhooks/dodo"])("returns an empty 499 for %s while its existing waitUntil handler finishes cleanup", async path => {
    const fixture = await beforeHeadersFixture(path);
    const response = withClientCancellation(fixture.request, fixture.respond);
    await fixture.ready;
    fixture.abort.abort();
    const cancelled = await response;
    expect(cancelled.status).toBe(499);
    expect(await cancelled.text()).toBe("");
    expect(cancelled.headers.get("cache-control")).toBe("no-store");
    await Promise.all(fixture.background);
    expect(fixture.cleaned()).toBe(true);
  });

  it("preserves a successful streaming response and removes its abort listener", async () => {
    const request = new Request("https://adcode.test");
    const remove = vi.spyOn(request.signal, "removeEventListener");
    const response = new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    expect(await withClientCancellation(request, async () => response)).toBe(response);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not start an already cancelled request or hide an active handler error", async () => {
    const abort = new AbortController(); abort.abort();
    const respond = vi.fn(async () => new Response("unused"));
    expect((await withClientCancellation(new Request("https://adcode.test", { signal: abort.signal }), respond)).status).toBe(499);
    expect(respond).not.toHaveBeenCalled();
    await expect(withClientCancellation(new Request("https://adcode.test"), async () => { throw new Error("handler failed"); })).rejects.toThrow("handler failed");
  });
});
