import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenVerifier } from "../src/auth.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_SETTINGS, EMPTY_MODEL_CATALOG } from "../src/modelCatalog.ts";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { modelName, windowFor, type TagflowOptions } from "../src/tagflow.ts";

/**
 * Tag Flow AI, relayed.
 *
 * Asked for: Tag Flow's models "already connected" on Sinan's key, so a new user can use the
 * AI straight away. The key cannot ship in an open-source app, so it lives in the worker and
 * this relay adds it: every request is tied to a verified (anonymous) account, capped per
 * user per window when the admin panel sets a limit, and streamed back as it arrives.
 */
const KEY = "tf-secret-key-value";
const NOW = 1_760_000_000_000;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "alice") return { uid: "u-alice", claims: {} };
    if (token === "bob") return { uid: "u-bob", claims: {} };
    return null;
  },
};

interface Upstream {
  readonly calls: { url: string; init: RequestInit | undefined }[];
  fetch: typeof fetch;
  reply: (url: string, init: RequestInit | undefined) => Promise<Response>;
}

function upstream(): Upstream {
  const state: Upstream = {
    calls: [],
    reply: async () => new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      state.calls.push({ url, init });
      return state.reply(url, init);
    }) as typeof fetch,
  };
  return state;
}

const chatBody = JSON.stringify({ model: "tagflow-code-27b", messages: [{ role: "user", content: "hi" }], stream: true });

describe("the Tag Flow relay", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let tagflow: Upstream;
  let now: number;
  let key: string | undefined;
  let handle: (request: Request) => Promise<Response>;

  const options = (): TagflowOptions => ({ apiKey: () => key, baseUrl: () => "https://tagflow.test/v1", fetch: tagflow.fetch });

  beforeEach(() => {
    store = createMemoryStore();
    tagflow = upstream();
    now = NOW;
    key = KEY;
    handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: options() });
  });

  const chat = (token: string | undefined, body: string = chatBody) =>
    handle(new Request("https://adcode.test/v1/ai/tagflow/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      body,
    }));

  const settings = async (patch: Partial<typeof DEFAULT_TAGFLOW_SETTINGS>) => {
    await store.putModelCatalog({ overrides: { ...EMPTY_MODEL_CATALOG, tagflow: { ...DEFAULT_TAGFLOW_SETTINGS, ...patch } }, updatedAt: 1, updatedBy: "admin" });
  };

  it("refuses a caller with no account", async () => {
    expect((await chat(undefined)).status).toBe(401);
    expect(tagflow.calls).toHaveLength(0);
  });

  it("forwards the request untouched, with the key, to Tag Flow's chat endpoint", async () => {
    const response = await chat("alice");
    expect(response.status).toBe(200);
    expect(tagflow.calls).toHaveLength(1);
    const [call] = tagflow.calls;
    expect(call?.url).toBe("https://tagflow.test/v1/chat/completions");
    expect(call?.init?.method).toBe("POST");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(call?.init?.body).toBe(chatBody);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: {}\n\n");
  });

  it("streams the reply as it arrives instead of after it finishes", async () => {
    let push: ((text: string) => void) | undefined;
    let finish: (() => void) | undefined;
    tagflow.reply = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        push = (text) => controller.enqueue(encoder.encode(text));
        finish = () => controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });

    const response = await chat("alice");
    const reader = response.body!.getReader();
    push?.("data: one\n\n");
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: one\n\n");
    push?.("data: two\n\n");
    finish?.();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("data: two\n\n");
  });

  it("is unavailable while the admin panel has it switched off", async () => {
    await settings({ enabled: false });
    const response = await chat("alice");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "tagflow_unavailable" } });
    expect(tagflow.calls).toHaveLength(0);
  });

  it("is unavailable, not broken, when the worker has no key", async () => {
    key = undefined;
    const response = await chat("alice");
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/Connect another model/);
  });

  it("never shows the key, even when Tag Flow echoes it back", async () => {
    tagflow.reply = async () => new Response(JSON.stringify({ error: { message: `bad request for key ${KEY}` } }), { status: 400, headers: { "content-type": "application/json" } });
    const response = await chat("alice");
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(KEY);
  });

  it("says Tag Flow is unavailable when it refuses the worker's key", async () => {
    tagflow.reply = async () => new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), { status: 401 });
    const response = await chat("alice");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "tagflow_unavailable" } });
  });

  it("passes Tag Flow's own rate limit through with its wait", async () => {
    tagflow.reply = async () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "7" } });
    const response = await chat("alice");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
  });

  it("answers 502 when Tag Flow cannot be reached", async () => {
    tagflow.reply = async () => {
      throw new TypeError("fetch failed");
    };
    const response = await chat("alice");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "tagflow_unreachable" } });
  });

  it.each([
    ["a body that is not JSON", "not json"],
    ["a body without a model", JSON.stringify({ messages: [] })],
    ["messages that are not a list", JSON.stringify({ model: "tagflow-code-27b", messages: "hi" })],
  ])("refuses %s", async (_label, body) => {
    expect((await chat("alice", body)).status).toBe(400);
    expect(tagflow.calls).toHaveLength(0);
  });

  it("refuses a body over eight megabytes", async () => {
    const huge = JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(8_000_001) }] });
    expect((await chat("alice", huge)).status).toBe(413);
    expect(tagflow.calls).toHaveLength(0);
  });

  it("is unlimited by default", async () => {
    for (let i = 0; i < 5; i++) expect((await chat("alice")).status).toBe(200);
  });

  describe("with a limit set in the admin panel", () => {
    beforeEach(async () => {
      await settings({ requestLimit: 2, windowHours: 5 });
    });

    it("stops a user at the limit and says when the window resets", async () => {
      expect((await chat("alice")).status).toBe(200);
      expect((await chat("alice")).status).toBe(200);
      const limited = await chat("alice");
      expect(limited.status).toBe(429);
      const { resetsAt } = windowFor(NOW, 5);
      expect(limited.headers.get("retry-after")).toBe(String(Math.ceil((resetsAt - NOW) / 1000)));
      expect(await limited.json()).toEqual({
        error: {
          message: expect.stringMatching(/Tag Flow AI/),
          type: "usage_limit",
          code: "tagflow_usage_limit",
          resets_at: resetsAt,
          auto_continue: true,
        },
      });
      expect(tagflow.calls).toHaveLength(2);
    });

    it("counts each user separately", async () => {
      await chat("alice");
      await chat("alice");
      expect((await chat("bob")).status).toBe(200);
    });

    it("lets the user back in when the window resets", async () => {
      await chat("alice");
      await chat("alice");
      now = windowFor(NOW, 5).resetsAt;
      expect((await chat("alice")).status).toBe(200);
    });

    it("tells the app not to continue on its own when auto-continue is off", async () => {
      await settings({ requestLimit: 1, autoContinue: false });
      await chat("alice");
      const body = await (await chat("alice")).json() as { error: { auto_continue: boolean } };
      expect(body.error.auto_continue).toBe(false);
    });
  });

  describe("the model list", () => {
    const models = (token = "alice") =>
      handle(new Request("https://adcode.test/v1/ai/tagflow/models", { headers: { authorization: `Bearer ${token}` } }));

    it("lists Tag Flow's own models and never the aliases that route to them", async () => {
      tagflow.reply = async () => Response.json({ service: "llm-gateway", models: ["tagflow-code-27b", "tagflow-chat-8b"], aliases: ["claude-sonnet-4", "gpt-4o"] });
      const response = await models();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        models: [
          { id: "tagflow-code-27b", name: "Tag Flow Code 27B" },
          { id: "tagflow-chat-8b", name: "Tag Flow Chat 8B" },
        ],
      });
      expect(tagflow.calls[0]?.url).toBe("https://tagflow.test/");
    });

    it("asks Tag Flow at most once every ten minutes", async () => {
      tagflow.reply = async () => Response.json({ models: ["tagflow-code-27b"] });
      await models();
      await models("bob");
      expect(tagflow.calls).toHaveLength(1);
      now += 600_001;
      await models();
      expect(tagflow.calls).toHaveLength(2);
    });

    it("falls back to the model it knows when Tag Flow cannot be reached", async () => {
      tagflow.reply = async () => {
        throw new TypeError("fetch failed");
      };
      expect(await (await models()).json()).toEqual({ models: [{ id: "tagflow-code-27b", name: "Tag Flow Code 27B" }] });
    });
  });
});

describe("the Node transport", () => {
  let server: ApiServer;
  afterEach(async () => {
    await server.close();
  });

  it("streams the relayed reply too", async () => {
    let push: ((text: string) => void) | undefined;
    let finish: (() => void) | undefined;
    const fake = upstream();
    fake.reply = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(new TextEncoder().encode(text));
        finish = () => controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    server = await createApiServer({ store: createMemoryStore(), verifier, tagflow: { apiKey: () => KEY, baseUrl: () => "https://tagflow.test/v1", fetch: fake.fetch } });

    const response = await fetch(`${server.url}/v1/ai/tagflow/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer alice", "content-type": "application/json" },
      body: chatBody,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    push?.("data: one\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: one\n\n");
    push?.("data: two\n\n");
    finish?.();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: two\n\n");
  });
});

describe("windowFor", () => {
  it("cuts time into fixed windows aligned to the epoch", () => {
    const hour = 3_600_000;
    expect(windowFor(5 * hour + 1, 5)).toEqual({ start: 5 * hour, resetsAt: 10 * hour });
    expect(windowFor(10 * hour, 5)).toEqual({ start: 10 * hour, resetsAt: 15 * hour });
  });
});

describe("modelName", () => {
  it.each([
    ["tagflow-code-27b", "Tag Flow Code 27B"],
    ["tagflow-chat-8b", "Tag Flow Chat 8B"],
    ["tagflow_reasoner", "Tag Flow Reasoner"],
    ["qwen3-coder", "Qwen3 Coder"],
  ])("names %s as %s", (id, name) => {
    expect(modelName(id)).toBe(name);
  });
});
