import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createMockServer, type MockServer } from "../src/server.ts";

let server: MockServer;
const auth = { authorization: "Bearer fake-id-token", "content-type": "application/json" };

beforeAll(async () => {
  server = await createMockServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await fetch(`${server.url}/__test__/reset`, { method: "POST" });
});

const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { headers });

/**
 * Read a response body loosely.
 *
 * These tests assert on the *wire shape* the mock produces. Typing them through the
 * client's interfaces would couple the two sides again and defeat the independence
 * that makes this mock able to catch a contract mismatch at all.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = async (res: Response): Promise<any> => await res.json();

describe("authentication", () => {
  // Brief §10: "All requests carry Authorization: Bearer <firebase-id-token>. Identity
  // comes from the token, never from a body field."
  it("rejects every /v1 endpoint without a bearer token", async () => {
    expect((await get("/v1/balance", {})).status).toBe(401);
    expect((await get("/v1/config", {})).status).toBe(401);
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
    expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
  });

  it("rejects a malformed authorization header", async () => {
    expect((await get("/v1/balance", { authorization: "fake-id-token" })).status).toBe(401);
    expect((await get("/v1/balance", { authorization: "Bearer " })).status).toBe(401);
  });
});

describe("POST /v1/serve", () => {
  it("returns creatives with both theme assets and a TTL", async () => {
    const res = await post("/v1/serve", { tags: ["lang:typescript"], themeKind: "dark", count: 3 });
    expect(res.status).toBe(200);

    const body = await jsonOf(res);
    expect(Array.isArray(body.creatives)).toBe(true);
    expect(body.creatives.length).toBeGreaterThan(0);
    expect(body.creatives.length).toBeLessThanOrEqual(3);

    for (const creative of body.creatives) {
      expect(creative.creativeId).toMatch(/^[A-Za-z0-9_-]+$/);
      // Advertised as https on the allowlisted host, even though the bytes are served
      // from localhost. The client validator would reject anything else.
      expect(creative.logoLight).toMatch(/^https:\/\/cdn\.adcode\.test\//);
      expect(creative.logoDark).toMatch(/^https:\/\/cdn\.adcode\.test\//);
      expect(typeof creative.ttlMs).toBe("number");
    }
  });

  it("advertises assets on the allowlisted host, not on its own address", () => {
    expect(server.assetHost).toBe("cdn.adcode.test");
    expect(server.publicAssetOrigin.startsWith("https://")).toBe(true);
    expect(server.assetOrigin.startsWith("http://127.0.0.1")).toBe(true);
  });

  it("honours the requested count", async () => {
    const res = await post("/v1/serve", { tags: [], themeKind: "light", count: 1 });
    expect((await jsonOf(res)).creatives).toHaveLength(1);
  });

  it("rejects a malformed body", async () => {
    expect((await post("/v1/serve", { tags: "not-an-array", themeKind: "dark", count: 1 })).status).toBe(400);
    expect((await post("/v1/serve", { tags: [], themeKind: "purple", count: 1 })).status).toBe(400);
  });

  it("serves a seeded creative verbatim, so tests are not flaky", async () => {
    server.seed([
      {
        creativeId: "seeded-1",
        advertiser: "Acme",
        headline: "a deterministic headline",
        body: null,
        clickUrl: "https://acme.test/",
        logoLight: `${server.publicAssetOrigin}/acme-light.png`,
        logoDark: `${server.publicAssetOrigin}/acme-dark.png`,
        ttlMs: 600_000,
      },
    ]);

    const body = await jsonOf(await post("/v1/serve", { tags: [], themeKind: "dark", count: 5 }));
    expect(body.creatives).toHaveLength(1);
    expect(body.creatives[0].creativeId).toBe("seeded-1");
  });
});

describe("POST /v1/receipts", () => {
  const receipt = (receiptId: string) => ({
    receiptId,
    creativeId: "cr-1",
    shownAt: 1_700_000_000_000,
    dwellMs: 5_000,
    themeKind: "dark" as const,
    outcome: "impression" as const,
  });

  it("acks the receipts it stored", async () => {
    const res = await post("/v1/receipts", { receipts: [receipt("r1"), receipt("r2")] });
    expect((await jsonOf(res)).acked.sort()).toEqual(["r1", "r2"]);
  });

  it("is idempotent by receiptId", async () => {
    // §9: "Deduped server-side by receipt ID so users do not lose earnings to flaky wifi."
    await post("/v1/receipts", { receipts: [receipt("r1")] });
    const second = await post("/v1/receipts", { receipts: [receipt("r1")] });

    expect((await jsonOf(second)).acked).toEqual(["r1"]);
    expect(server.receiptCount()).toBe(1);
  });

  it("accepts an empty batch", async () => {
    expect((await jsonOf(await post("/v1/receipts", { receipts: [] }))).acked).toEqual([]);
  });

  it("rejects a malformed receipt", async () => {
    expect((await post("/v1/receipts", { receipts: [{ receiptId: "r1" }] })).status).toBe(400);
  });
});

describe("GET /v1/balance", () => {
  it("returns money as decimal strings, never numbers", async () => {
    const body = await jsonOf(await get("/v1/balance"));
    expect(typeof body.availableMicros).toBe("string");
    expect(typeof body.lifetimeMicros).toBe("string");
    expect(body.availableMicros).toMatch(/^-?[0-9]+$/);
  });

  it("accrues as receipts arrive, because the server owns the balance", async () => {
    const before = BigInt((await jsonOf(await get("/v1/balance"))).availableMicros);
    await post("/v1/receipts", {
      receipts: [
        {
          receiptId: "r-accrue",
          creativeId: "cr-1",
          shownAt: 1,
          dwellMs: 5_000,
          themeKind: "dark",
          outcome: "impression",
        },
      ],
    });
    const after = BigInt((await jsonOf(await get("/v1/balance"))).availableMicros);
    expect(after).toBeGreaterThan(before);
  });
});

describe("GET /v1/config", () => {
  it("serves a projection for every preset", async () => {
    const body = await jsonOf(await get("/v1/config"));
    expect(Object.keys(body.projections).sort()).toEqual(["light", "max", "off", "standard"]);
    for (const value of Object.values(body.projections)) expect(value).toMatch(/^[0-9]+$/);
  });

  it("serves a kill switch and caps", async () => {
    const body = await jsonOf(await get("/v1/config"));
    expect(typeof body.killSwitch).toBe("boolean");
    expect(typeof body.caps).toBe("object");
  });

  it("can be driven to kill-switch on", async () => {
    server.setKillSwitch(true);
    expect((await jsonOf(await get("/v1/config"))).killSwitch).toBe(true);
  });
});

describe("asset host", () => {
  it("serves creative assets over the asset origin", async () => {
    const res = await fetch(`${server.assetOrigin}/acme-light.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

describe("fault injection", () => {
  it("can be told to fail, so client backoff is testable", async () => {
    server.failNext(2, 503);
    expect((await get("/v1/balance")).status).toBe(503);
    expect((await get("/v1/balance")).status).toBe(503);
    expect((await get("/v1/balance")).status).toBe(200);
  });

  it("can return malformed JSON", async () => {
    server.corruptNext(1);
    const res = await get("/v1/balance");
    expect(res.status).toBe(200);
    await expect(res.json()).rejects.toThrow();
  });

  it("can hang, so client timeouts are testable", async () => {
    server.hangNext(1, 200);
    const started = Date.now();
    await get("/v1/balance");
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});

describe("POST /__test__/reset", () => {
  it("clears receipts, balance, seeds, and fault injection", async () => {
    await post("/v1/receipts", {
      receipts: [
        {
          receiptId: "r1",
          creativeId: "cr-1",
          shownAt: 1,
          dwellMs: 5_000,
          themeKind: "dark",
          outcome: "impression",
        },
      ],
    });
    server.setKillSwitch(true);
    expect(server.receiptCount()).toBe(1);

    await fetch(`${server.url}/__test__/reset`, { method: "POST" });

    expect(server.receiptCount()).toBe(0);
    expect((await jsonOf(await get("/v1/config"))).killSwitch).toBe(false);
  });
});
