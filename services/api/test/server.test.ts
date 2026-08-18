import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "good") return { uid: "u-1", claims: {} };
    if (token === "admin") return { uid: "admin-1", claims: { admin: true } };
    return null;
  },
};

let server: ApiServer;
let store: ReturnType<typeof createMemoryStore>;
const auth = { authorization: "Bearer good", "content-type": "application/json" };

beforeAll(async () => {
  store = createMemoryStore();
  server = await createApiServer({ store, verifier });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  store.reset();
});

const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { headers });

const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("authentication", () => {
  it("rejects every /v1 endpoint without a bearer token", async () => {
    expect((await get("/v1/balance", {})).status).toBe(401);
    expect((await get("/v1/config", {})).status).toBe(401);
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
    expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const headers = { authorization: "Bearer forged", "content-type": "application/json" };
    expect((await get("/v1/balance", headers)).status).toBe(401);
  });

  it("rejects a banned user with 403, not 401", async () => {
    // A 401 tells a client to retry auth, which a banned client would do forever.
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });
    expect((await get("/v1/balance")).status).toBe(403);
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    expect((await get("/v1/nope")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });

  it("400s a malformed serve body", async () => {
    expect((await post("/v1/serve", { tags: "no", themeKind: "dark", count: 1 })).status).toBe(400);
  });

  it("400s a body that is not JSON", async () => {
    const res = await fetch(`${server.url}/v1/serve`, { method: "POST", headers: auth, body: "{{{" });
    expect(res.status).toBe(400);
  });

  it("serves the balance as decimal strings", async () => {
    const res = await get("/v1/balance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ availableMicros: "0", lifetimeMicros: "0" });
  });

  it("serves the ledger, empty for a new user", async () => {
    const res = await get("/v1/ledger");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });

  it("serves the config", async () => {
    const body = (await (await get("/v1/config")).json()) as Record<string, unknown>;
    expect(body["killSwitch"]).toBe(false);
  });

  it("refuses a GET where the contract says POST", async () => {
    expect((await get("/v1/serve")).status).toBe(404);
  });
});

describe("reports", () => {
  const report = {
    kind: "bug",
    title: "Terminal freezes",
    body: "Splitting a third time stops accepting input.",
    appVersion: "0.1.0",
    platform: "win32",
  };

  it("accepts a report and returns its id", async () => {
    const res = await post("/v1/reports", report);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toHaveProperty("reportId");
  });

  it("400s a malformed report", async () => {
    expect((await post("/v1/reports", { ...report, kind: "lawsuit" })).status).toBe(400);
    expect((await post("/v1/reports", { ...report, title: "" })).status).toBe(400);
  });

  it("requires a token", async () => {
    expect((await post("/v1/reports", report, {})).status).toBe(401);
  });

  it("refuses a non-admin listing reports", async () => {
    expect((await get("/v1/admin/reports")).status).toBe(403);
  });

  it("lets an admin read what was filed", async () => {
    await post("/v1/reports", report);
    const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
    const body = (await (await get("/v1/admin/reports", adminHeaders)).json()) as {
      rows: Record<string, unknown>[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.["title"]).toBe("Terminal freezes");
  });
});

describe("rate limiting", () => {
  it("429s a user over the ceiling, and says when to come back", async () => {
    const cfg = await store.getConfig();
    await store.putConfig({ ...cfg, requestsPerWindow: 3, rateWindowMs: 60_000 });

    for (let i = 0; i < 3; i++) expect((await get("/v1/balance")).status).toBe(200);

    const limited = await get("/v1/balance");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("limits every endpoint, not just the expensive one", async () => {
    const cfg = await store.getConfig();
    await store.putConfig({ ...cfg, requestsPerWindow: 1, rateWindowMs: 60_000 });

    await get("/v1/config");
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 })).status).toBe(429);
  });
});

describe("admin routes", () => {
  const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };

  it("refuses a non-admin with 403", async () => {
    expect((await get("/v1/admin/users/u-1/ledger")).status).toBe(403);
  });

  it("allows an admin", async () => {
    const res = await get("/v1/admin/users/u-1/ledger", adminHeaders);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });

  it("still requires a token", async () => {
    expect((await get("/v1/admin/users/u-1/ledger", {})).status).toBe(401);
  });
});
