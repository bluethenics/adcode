import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";

/**
 * POST /v1/earnings/convert: ad earnings into AI credits.
 *
 * The rules are in earningsConversion.test.ts and the SQL in
 * scripts/check-earnings-conversion-sql.mjs. This covers what the wire promises: one move
 * per request id however often it arrives, a refusal that moves nothing, and a server that
 * never takes the client's word for a rate or a balance.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "good") return { uid: "u-1", claims: { email: "ada@example.com", email_verified: true } };
    if (token === "anon") return { uid: "u-anon", claims: {} };
    return null;
  },
};

const user = { authorization: "Bearer good", "content-type": "application/json" };
const anon = { authorization: "Bearer anon", "content-type": "application/json" };
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

let server: ApiServer;
let store: ReturnType<typeof createMemoryStore>;

const get = (headers: Record<string, string> = user) => fetch(`${server.url}/v1/earnings/convert`, { headers });
const post = (body: unknown, headers: Record<string, string> = user) =>
  fetch(`${server.url}/v1/earnings/convert`, { method: "POST", headers, body: JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(response: Response): Promise<T> => (await response.json()) as T;

async function earn(micros: bigint): Promise<void> {
  // The first request creates the account; this confirms its email and gives it earnings.
  await fetch(`${server.url}/v1/balance`, { headers: user });
  await store.putUser({ uid: "u-1", status: "active", createdAt: 0, email: "ada@example.com", emailVerified: true });
  await store.appendEntryAndUpdateBalance({
    entryId: `seed-${Math.random()}`, uid: "u-1", kind: "impression", micros, refId: null, createdAt: 0, description: "seed",
  });
}

const balances = async () => {
  const earnings = (await store.getBalance("u-1")).availableMicros;
  const credits = (await store.getModelWallet("u-1", Date.now())).balanceMicros;
  return { earnings, credits };
};

beforeEach(async () => {
  store = createMemoryStore();
  server = await createApiServer({ store, verifier });
});

afterEach(async () => {
  await server.close();
});

describe("POST /v1/earnings/convert", () => {
  it("moves earnings into credits and answers with both new balances", async () => {
    await earn(5_000_000n);
    const response = await post({ requestId: ID_A, amountMicros: "2000000" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await json(response)).toEqual({
      status: "converted", requestId: ID_A, earningsMicros: "2000000", creditMicros: "2000000",
      availableMicros: "3000000", creditBalanceMicros: "2000000",
    });
    expect(await balances()).toEqual({ earnings: 3_000_000n, credits: 2_000_000 });
    // Lifetime earnings keep it: the person earned it, they chose credits over cash.
    expect((await store.getBalance("u-1")).lifetimeMicros).toBe(5_000_000n);
    const ledger = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(ledger.rows.some((row) => row.kind === "credit_conversion" && row.micros === -2_000_000n)).toBe(true);
    const wallet = await store.getModelWallet("u-1", Date.now());
    expect(wallet.activity[0]).toMatchObject({ kind: "earnings", deltaMicros: 2_000_000 });
  });

  it("pays once however many times the same request arrives", async () => {
    await earn(5_000_000n);
    // A double (triple) click: all in flight at once, before any of them has landed.
    const responses = await Promise.all([1, 2, 3].map(() => post({ requestId: ID_A, amountMicros: "2000000" })));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const bodies = await Promise.all(responses.map((r) => json(r)));
    expect(bodies.map((b) => b["status"]).sort()).toEqual(["converted", "replayed", "replayed"]);
    expect(bodies.every((b) => b["creditBalanceMicros"] === "2000000")).toBe(true);
    expect(await balances()).toEqual({ earnings: 3_000_000n, credits: 2_000_000 });
  });

  it("answers a retry with the original success even after the balance fell below it", async () => {
    await earn(2_000_000n);
    expect((await post({ requestId: ID_A, amountMicros: "2000000" })).status).toBe(200);
    const retry = await post({ requestId: ID_A, amountMicros: "2000000" });
    expect(retry.status).toBe(200);
    expect(await json(retry)).toMatchObject({ status: "replayed", availableMicros: "0" });
  });

  it("refuses the same request id with a different amount", async () => {
    await earn(5_000_000n);
    await post({ requestId: ID_A, amountMicros: "2000000" });
    const response = await post({ requestId: ID_A, amountMicros: "1000000" });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "request-id-reused" });
    expect(await balances()).toEqual({ earnings: 3_000_000n, credits: 2_000_000 });
  });

  it("refuses more than is available and moves nothing", async () => {
    await earn(1_500_000n);
    const response = await post({ requestId: ID_A, amountMicros: "2000000" });
    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "insufficient-funds", availableMicros: "1500000" });
    expect(await balances()).toEqual({ earnings: 1_500_000n, credits: 0 });
  });

  it("refuses when two different requests together would overspend", async () => {
    await earn(3_000_000n);
    const [a, b] = await Promise.all([
      post({ requestId: ID_A, amountMicros: "2000000" }),
      post({ requestId: ID_B, amountMicros: "2000000" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect(await balances()).toEqual({ earnings: 1_000_000n, credits: 2_000_000 });
  });

  it.each([
    [{ requestId: ID_A, amountMicros: "100000" }, 422, "below-minimum"],
    [{ requestId: ID_A, amountMicros: "1000010000" }, 422, "above-maximum"],
    [{ requestId: ID_A, amountMicros: "1000001" }, 422, "not-whole-cents"],
    [{ requestId: ID_A, amountMicros: "1000000", rate: "5" }, 400, "invalid-request"],
    [{ requestId: "x", amountMicros: "1000000" }, 400, "invalid-request-id"],
  ])("refuses %j with %i %s", async (body, status, error) => {
    await earn(5_000_000n);
    const response = await post(body);
    expect(response.status).toBe(status);
    expect(await json(response)).toEqual({ error });
    expect(await balances()).toEqual({ earnings: 5_000_000n, credits: 0 });
  });

  it("refuses an account without a confirmed email", async () => {
    const response = await post({ requestId: ID_A, amountMicros: "1000000" }, anon);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "verify-email" });
  });

  it("refuses an account whose paid models are blocked", async () => {
    await earn(5_000_000n);
    await store.putTagflowPolicy("u-1", { blocked: true, limits: null, updatedAt: 0, updatedBy: "admin-1" });
    const response = await post({ requestId: ID_A, amountMicros: "1000000" });
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "blocked" });
  });

  it("needs a signed-in caller", async () => {
    expect((await post({ requestId: ID_A, amountMicros: "1000000" }, { "content-type": "application/json" })).status).toBe(401);
  });
});

describe("GET /v1/earnings/convert", () => {
  it("quotes both balances, the rate and the limits from the server", async () => {
    await earn(3_456_789n);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      availableMicros: "3456789",
      creditBalanceMicros: "0",
      convertedTodayMicros: "0",
      minMicros: "500000",
      maxMicros: "1000000000",
      dailyCapMicros: "1000000000",
      stepMicros: "10000",
      convertibleMaxMicros: "3450000",
      rate: { earningsMicros: "1", creditMicros: "1" },
      blocked: null,
    });
  });

  it("counts today's conversions against the daily cap", async () => {
    await earn(5_000_000n);
    await post({ requestId: ID_A, amountMicros: "2000000" });
    expect(await json(await get())).toMatchObject({ convertedTodayMicros: "2000000", availableMicros: "3000000", creditBalanceMicros: "2000000" });
  });

  it("says why nothing can be converted instead of failing", async () => {
    expect(await json(await get(anon))).toMatchObject({ blocked: "verify-email", convertibleMaxMicros: "0" });
    await earn(100_000n);
    expect(await json(await get())).toMatchObject({ blocked: "below-minimum", convertibleMaxMicros: "0" });
  });
});
