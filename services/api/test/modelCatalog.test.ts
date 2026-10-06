import { beforeEach, describe, expect, it } from "vitest";
import type { TokenVerifier } from "../src/auth.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { EMPTY_MODEL_CATALOG, parseModelCatalog } from "../src/modelCatalog.ts";

/**
 * The model list, curated from the admin panel.
 *
 * Asked for: "if new models come up I want to update them from the admin panel". The panel
 * saves one small document - which model each provider starts on, which to feature, which to
 * hide, notes, and models to add before models.dev lists them - and the desktop app reads it
 * on launch from GET /v1/models/overrides. Saving is admin-only and refuses anything malformed:
 * this document reaches every editor.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user") return { uid: "u-1", claims: {} };
    return null;
  },
};

const sample = {
  recommended: { openai: "gpt-6.1-sol", openrouter: "anthropic/claude-sonnet-5.5" },
  hidden: ["openrouter:stealth/space-bunny-alpha"],
  featured: ["google:gemini-flash-latest"],
  notes: { "google:gemini-flash-latest": "Free tier - the quickest way to start" },
  added: [{ provider: "openai", id: "gpt-7", name: "GPT-7", contextWindow: 2_000_000, maxOutput: 128_000, reasoning: true, effortLevels: ["low", "medium", "high"], inputPrice: 3, outputPrice: 15, releaseDate: "2026-10-05" }],
};

describe("parseModelCatalog", () => {
  it("accepts a well-formed document", () => {
    expect(parseModelCatalog(sample)).toEqual(sample);
  });

  it("accepts an empty one, which clears every override", () => {
    expect(parseModelCatalog({})).toEqual(EMPTY_MODEL_CATALOG);
  });

  it.each([
    ["not an object", "x"],
    ["a key without its provider", { hidden: ["stealth"] }],
    ["a recommended model that is not a string", { recommended: { openai: 5 } }],
    ["a note far too long", { notes: { "openai:gpt-6.1-sol": "x".repeat(400) } }],
    ["an added model without an id", { added: [{ provider: "openai", name: "Nameless" }] }],
    ["an impossible context size", { added: [{ provider: "openai", id: "m", name: "M", contextWindow: -1 }] }],
    ["an unknown field", { surprise: true }],
  ])("refuses %s", (_label, raw) => {
    expect(parseModelCatalog(raw)).toBeNull();
  });
});

describe("the routes", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    let now = 5_000;
    handle = createFetchHandler({ store, verifier, clock: { now: () => (now += 1) } });
  });

  const call = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
    handle(new Request(`https://adcode.test${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }));

  it("answers the public read with no overrides before any are saved", async () => {
    const response = await call("/v1/models/overrides");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ overrides: EMPTY_MODEL_CATALOG, updatedAt: 0 });
    // Every editor asks on launch: let the edge answer most of them.
    expect(response.headers.get("cache-control")).toMatch(/public/);
  });

  it("saves from the admin panel and serves what was saved", async () => {
    const saved = await call("/v1/admin/models", { method: "POST", token: "admin", body: sample });
    expect(saved.status).toBe(200);

    const read = await (await call("/v1/models/overrides")).json() as { overrides: unknown; updatedAt: number };
    expect(read.overrides).toEqual(sample);
    expect(read.updatedAt).toBeGreaterThan(0);

    const admin = await (await call("/v1/admin/models", { token: "admin" })).json() as { updatedBy: string | null };
    expect(admin.updatedBy).toBe("admin-1");
  });

  it("refuses a save from anyone who is not an admin", async () => {
    expect((await call("/v1/admin/models", { method: "POST", token: "user", body: sample })).status).toBe(403);
    expect((await call("/v1/admin/models", { method: "POST", body: sample })).status).toBe(401);
  });

  it("refuses a malformed document and keeps the last good one", async () => {
    await call("/v1/admin/models", { method: "POST", token: "admin", body: sample });
    expect((await call("/v1/admin/models", { method: "POST", token: "admin", body: { hidden: ["broken"] } })).status).toBe(400);
    const read = await (await call("/v1/models/overrides")).json() as { overrides: unknown };
    expect(read.overrides).toEqual(sample);
  });

  it("records who changed the list", async () => {
    await call("/v1/admin/models", { method: "POST", token: "admin", body: sample });
    expect((await store.listAudit()).some((record) => record.action === "save-model-catalog" && record.adminUid === "admin-1")).toBe(true);
  });
});
