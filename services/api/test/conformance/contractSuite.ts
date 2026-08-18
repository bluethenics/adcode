/**
 * The contract, as a suite that runs against any implementation of it.
 *
 * Spec D3: `mock-server` and `services/api` are independent implementations of the same
 * wire contract, and the only way to know they still agree is to run the same assertions
 * against both. Drift becomes a test failure rather than a production incident.
 *
 * These assertions read the wire shape loosely on purpose. Typing them through either
 * side's interfaces would couple them again and defeat the independence that makes the
 * comparison meaningful.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

export interface Harness {
  url: string;
  close(): Promise<void>;
  reset(): Promise<void>;
}

/** Loose reads: the point is the wire shape, not either side's types. */
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function describeContract(name: string, start: () => Promise<Harness>): void {
  describe(`contract: ${name}`, () => {
    let harness: Harness;
    const auth = { authorization: "Bearer good", "content-type": "application/json" };

    beforeAll(async () => {
      harness = await start();
    });

    afterAll(async () => {
      await harness.close();
    });

    beforeEach(async () => {
      await harness.reset();
    });

    const get = (path: string, headers: Record<string, string> = auth) =>
      fetch(`${harness.url}${path}`, { headers });

    const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
      fetch(`${harness.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    it("rejects every endpoint without a bearer token", async () => {
      expect((await get("/v1/balance", {})).status).toBe(401);
      expect((await get("/v1/config", {})).status).toBe(401);
      expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
      expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
    });

    it("returns balance as decimal integer strings", async () => {
      const body = (await (await get("/v1/balance")).json()) as Loose;
      expect(typeof body["availableMicros"]).toBe("string");
      expect(typeof body["lifetimeMicros"]).toBe("string");
      expect(body["availableMicros"]).toMatch(/^-?[0-9]{1,19}$/);
      expect(body["lifetimeMicros"]).toMatch(/^-?[0-9]{1,19}$/);
    });

    it("returns a config with a projection for every cadence", async () => {
      const body = (await (await get("/v1/config")).json()) as Loose;
      expect(typeof body["killSwitch"]).toBe("boolean");
      expect(typeof body["caps"]).toBe("object");
      for (const preset of ["off", "light", "standard", "max"]) {
        expect(typeof body["projections"][preset]).toBe("string");
        expect(body["projections"][preset]).toMatch(/^-?[0-9]{1,19}$/);
      }
    });

    it("rejects a malformed serve request with 400", async () => {
      expect((await post("/v1/serve", { tags: "no", themeKind: "dark", count: 1 })).status).toBe(400);
      expect((await post("/v1/serve", { tags: [], themeKind: "puce", count: 1 })).status).toBe(400);
      expect((await post("/v1/serve", { tags: [], themeKind: "dark" })).status).toBe(400);
    });

    it("returns creatives within the client's field limits", async () => {
      const res = await post("/v1/serve", { tags: ["lang:rust"], themeKind: "dark", count: 3 });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { creatives: Loose[] };
      expect(Array.isArray(body.creatives)).toBe(true);
      expect(body.creatives.length).toBeLessThanOrEqual(50);

      for (const c of body.creatives) {
        expect(c["creativeId"]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(String(c["advertiser"]).length).toBeLessThanOrEqual(40);
        expect(String(c["headline"]).length).toBeLessThanOrEqual(80);
        if (c["body"] !== null) expect(String(c["body"]).length).toBeLessThanOrEqual(160);
        expect(String(c["clickUrl"]).length).toBeLessThanOrEqual(2048);
        expect(typeof c["ttlMs"]).toBe("number");
      }
    });

    it("returns at least one creative when inventory matches", async () => {
      const body = (await (await post("/v1/serve", { tags: ["lang:rust"], themeKind: "dark", count: 3 })).json()) as {
        creatives: Loose[];
      };
      // Guards against the serve assertions passing vacuously against an empty pool.
      expect(body.creatives.length).toBeGreaterThan(0);
    });

    it("never returns more creatives than asked for", async () => {
      const body = (await (await post("/v1/serve", { tags: ["lang:rust"], themeKind: "dark", count: 1 })).json()) as {
        creatives: unknown[];
      };
      expect(body.creatives.length).toBeLessThanOrEqual(1);
    });

    it("acks every receipt it is sent", async () => {
      const receipt = {
        receiptId: "rconformance1",
        creativeId: "c-1",
        shownAt: Date.now() - 5_000,
        dwellMs: 4_200,
        themeKind: "dark",
        outcome: "impression",
      };
      const body = (await (await post("/v1/receipts", { receipts: [receipt] })).json()) as {
        acked: string[];
      };
      expect(body.acked).toContain("rconformance1");
    });

    it("is idempotent on a replayed receipt", async () => {
      const receipt = {
        receiptId: "rconformance2",
        creativeId: "c-1",
        shownAt: Date.now() - 5_000,
        dwellMs: 4_200,
        themeKind: "dark",
        outcome: "impression",
      };
      await post("/v1/receipts", { receipts: [receipt] });
      const before = (await (await get("/v1/balance")).json()) as Loose;

      await post("/v1/receipts", { receipts: [receipt] });
      const after = (await (await get("/v1/balance")).json()) as Loose;

      expect(after["availableMicros"]).toBe(before["availableMicros"]);
    });

    it("acks an empty batch", async () => {
      const body = (await (await post("/v1/receipts", { receipts: [] })).json()) as { acked: string[] };
      expect(body.acked).toEqual([]);
    });

    it("404s an unknown path", async () => {
      expect((await get("/v1/definitely-not-a-route")).status).toBe(404);
    });
  });
}
