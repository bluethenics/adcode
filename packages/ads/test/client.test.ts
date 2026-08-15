import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createMockServer, type MockServer } from "../../../mock-server/src/server.ts";
import { createAdClient, type AdClient } from "../src/client.ts";
import { FakeClock, FakeHttpTransport, FakeTokenProvider } from "./fakes.ts";
import { BridgingHttpTransport } from "./httpBridge.ts";
import type { Receipt } from "../src/types.ts";

let server: MockServer;
let transport: BridgingHttpTransport;
let tokens: FakeTokenProvider;
let client: AdClient;

beforeAll(async () => {
  server = await createMockServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await fetch(`${server.url}/__test__/reset`, { method: "POST" });
  transport = new BridgingHttpTransport([[server.publicAssetOrigin, server.assetOrigin]]);
  tokens = new FakeTokenProvider("test-token");
  client = createAdClient({
    http: transport,
    tokens,
    clock: new FakeClock(),
    baseUrl: `${server.url}/v1`,
    assetHost: server.assetHost,
  });
});

const receipt = (receiptId: string): Receipt => ({
  receiptId,
  creativeId: "cr-1",
  shownAt: 1_700_000_000_000,
  dwellMs: 5_000,
  themeKind: "dark",
  outcome: "impression",
});

describe("serve", () => {
  it("returns validated creatives from the real mock server", async () => {
    const result = await client.serve({ tags: ["lang:typescript"], themeKind: "dark", count: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.logoLight).toMatch(/^https:\/\/cdn\.adcode\.test\//);
    }
  });

  it("sends identity in the header and never in the body", async () => {
    // Brief §10: "Identity comes from the token, never from a body field."
    await client.serve({ tags: ["lang:rust"], themeKind: "dark", count: 1 });

    const call = transport.calls.at(-1)!;
    expect(call.headers["authorization"]).toBe("Bearer test-token");
    expect(call.body ?? "").not.toMatch(/uid|localId|idToken|bearer/i);
  });

  it("sends only the tags it was given", async () => {
    await client.serve({ tags: ["lang:go"], themeKind: "light", count: 2 });

    const body = JSON.parse(transport.calls.at(-1)!.body ?? "{}");
    expect(body).toEqual({ tags: ["lang:go"], themeKind: "light", count: 2 });
  });

  it("fails without a token rather than calling unauthenticated", async () => {
    tokens.setToken({ kind: "auth", detail: "no identity" });
    const result = await client.serve({ tags: [], themeKind: "dark", count: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("receipts", () => {
  it("posts a batch and returns the acked ids", async () => {
    const result = await client.postReceipts([receipt("r1"), receipt("r2")]);

    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.value].sort()).toEqual(["r1", "r2"]);
  });

  it("is idempotent - a resend after flaky wifi does not double-pay or lose the earning", async () => {
    await client.postReceipts([receipt("r1")]);
    const again = await client.postReceipts([receipt("r1")]);

    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value).toEqual(["r1"]);
    expect(server.receiptCount()).toBe(1);
  });
});

describe("balance and config", () => {
  it("parses money as bigint, not as a number", async () => {
    await client.postReceipts([receipt("r1")]);
    const result = await client.balance();

    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.value.availableMicros).toBe("bigint");
  });

  it("returns a projections table for every preset", async () => {
    const result = await client.config();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.projections).sort()).toEqual(["light", "max", "off", "standard"]);
      expect(typeof result.value.projections.standard).toBe("bigint");
    }
  });
});

describe("failure handling", () => {
  it("retries a 5xx and succeeds once the server recovers", async () => {
    server.failNext(2, 503);
    const result = await client.balance();

    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(3);
  });

  it("gives up after the retry budget and returns an error rather than throwing", async () => {
    server.failNext(50, 500);
    const result = await client.balance();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("http");
  });

  it("does not retry a 4xx", async () => {
    // Retrying a request the server has rejected on its merits only wastes the user's
    // battery and the server's capacity.
    server.failNext(5, 400);
    const result = await client.balance();

    expect(result.ok).toBe(false);
    expect(transport.calls).toHaveLength(1);
  });

  it("returns a validation error on malformed JSON", async () => {
    server.corruptNext(1);
    const result = await client.balance();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("times out rather than hanging", async () => {
    server.hangNext(1, 3_000);
    const fast = createAdClient({
      http: transport,
      tokens,
      clock: new FakeClock(),
      baseUrl: `${server.url}/v1`,
      assetHost: server.assetHost,
      timeoutMs: 150,
      maxAttempts: 1,
    });

    const result = await fast.balance();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["timeout", "network"]).toContain(result.error.kind);
  });

  it("invalidates the token on a 401 so the next call re-authenticates", async () => {
    const offline = new FakeHttpTransport([{ status: 401, json: { error: "unauthorized" } }]);
    const unauthorised = createAdClient({
      http: offline,
      tokens,
      clock: new FakeClock(),
      baseUrl: `${server.url}/v1`,
      assetHost: server.assetHost,
      maxAttempts: 1,
    });

    await unauthorised.balance();
    expect(tokens.invalidated).toBe(1);
  });

  it("surfaces a transport failure as an error, never as a throw", async () => {
    const dead = new FakeHttpTransport([], { throws: new Error("ECONNREFUSED") });
    const offline = createAdClient({
      http: dead,
      tokens,
      clock: new FakeClock(),
      baseUrl: `${server.url}/v1`,
      assetHost: server.assetHost,
      maxAttempts: 1,
    });

    const result = await offline.serve({ tags: [], themeKind: "dark", count: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });

  it("rejects a creative from a host that is not allowlisted", async () => {
    // The end of the §1 chain: even a compromised serving endpoint cannot get an asset
    // URL past the client onto a user's machine.
    server.seed([
      {
        creativeId: "hostile",
        advertiser: "Evil",
        headline: "tracking you",
        body: null,
        clickUrl: "https://evil.test/",
        logoLight: "https://evil-cdn.adcode.test/a.png",
        logoDark: "https://evil-cdn.adcode.test/b.png",
        ttlMs: 1000,
      },
    ]);

    const result = await client.serve({ tags: [], themeKind: "dark", count: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });
});
